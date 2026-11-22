// Servicio de facturación (RF-V).
//
// Capa de servicios (AGENTS.md sección 3, consigna sección 10): todas las
// reglas de la venta viven acá. Las rutas de app/api/facturas/ solo exigen
// la sesión, leen el pedido, llaman a estas funciones y responden.
//
// Cada función recibe el usuario autenticado y los datos SIN VALIDAR, y
// sigue el mismo orden: valida, verifica el permiso, aplica las reglas,
// devuelve el resultado. Si algo no se puede hacer, lanza un ApiError.
//
//   crearFactura    RF-V1 a RF-V6
//   listarFacturas  RF-V8
//   obtenerFactura  RF-V7
//   anularFactura   RF-V9
//   proximoNumero   RF-V4 (informativo: el numero real lo asigna crearFactura)
//
// NOMBRES DE CAMPO (AGENTS.md 5.1, consigna 11.6): la API usa los nombres
// exactos de la consigna (total, precioUnitario, vendedor, pago.forma...),
// que NO son los de las columnas de la base (total_centavos, usuario_id,
// forma_pago...). Este servicio traduce: lee con los nombres de la base y
// devuelve con los de la consigna. Los importes siguen siendo centavos
// enteros; solo cambia el nombre del campo.

import { eq, and, or, gte, lt, like, inArray, max, desc, count, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/index';
import { usuarios, clientes, productos, facturas, facturaItems, movimientosCuenta } from '@/db/schema';
import { ApiError } from '@/lib/errores';
import { formatearNumeroFactura } from '@/lib/formato';
import { moverStock } from '@/lib/servicios/stock';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual)
export type UsuarioSesion = { id: number; nombre: string; rol: 'admin' | 'vendedor' };

// ─────────────────────────────────────────────────────────────
// La factura completa, tal como la devuelve la API (consigna 11.6).
// La usan el POST, el detalle, la anulación y las pantallas.
// ─────────────────────────────────────────────────────────────
export type FacturaCompleta = {
  id: number;
  puntoVenta: number;
  numero: number; // ENTERO: 1233
  numeroFormateado: string; // texto: "0001-00001233"
  fecha: string;
  estado: 'emitida' | 'anulada';
  cliente: {
    id: number;
    nombre: string;
    tipoDoc: 'DNI' | 'CUIT';
    nroDoc: string;
    domicilio: string | null;
  } | null; // null = consumidor final
  vendedor: { id: number; nombre: string };
  items: {
    productoId: number;
    codigo: string;
    descripcion: string;
    cantidad: number;
    precioUnitario: number;
    subtotal: number;
  }[];
  total: number;
  // El contenido de "pago" depende de la forma:
  //   contado          → { forma, montoRecibido, vuelto }
  //   tarjeta          → { forma, tarjeta: { tipo, marca, ultimos4 } }
  //   cuenta_corriente → { forma }
  pago: {
    forma: 'contado' | 'tarjeta' | 'cuenta_corriente';
    montoRecibido?: number;
    vuelto?: number;
    tarjeta?: { tipo: string | null; marca: string | null; ultimos4: string | null };
  };
  saldoCliente?: number; // solo en ventas a cuenta corriente
  anulacion?: { fecha: string; usuario: { id: number; nombre: string } | null; motivo: string }; // solo si está anulada
};

// Por ahora hay un solo punto de venta
const PUNTO_VENTA = 1;

// Los únicos campos que el cliente puede mandar al facturar (consigna
// 11.6). Cualquier otro (total, precio, numero, fecha...) se rechaza con
// 422: los precios, el total, el número y la fecha los asigna el servidor
// (sección 11.1).
const CAMPOS_PERMITIDOS = ['clienteId', 'items', 'pago'];
const CAMPOS_PERMITIDOS_ITEM = ['productoId', 'cantidad'];
const CAMPOS_PERMITIDOS_PAGO = ['forma', 'montoRecibido', 'tarjeta'];
const CAMPOS_PERMITIDOS_TARJETA = ['tipo', 'marca', 'ultimos4'];

// Un error 422 VALIDACION sobre un campo, con el formato de "details"
// de la sección 11.1: [{ campo, mensaje }]
function errorDeValidacion(campo: string, mensaje: string) {
  return new ApiError(422, 'VALIDACION', mensaje, [{ campo, mensaje }]);
}

// Saldo actual de un cliente (regla 7): débitos − créditos, siempre desde
// movimientos_cuenta. Recibe tx o db, según quién la llame.
async function calcularSaldo(conexion: Pick<typeof db, 'select'>, clienteId: number) {
  const movimientos = await conexion
    .select()
    .from(movimientosCuenta)
    .where(eq(movimientosCuenta.clienteId, clienteId));

  let saldo = 0;
  for (const mov of movimientos) {
    if (mov.tipo === 'debito') {
      saldo = saldo + mov.importeCentavos;
    } else {
      saldo = saldo - mov.importeCentavos;
    }
  }
  return saldo;
}

// ═════════════════════════════════════════════════════════════
// crearFactura — emitir una factura (RF-V1 a RF-V6)
//
// datos (sin validar), formato de la consigna 11.6:
// {
//   "clienteId": 1,                                   // null = consumidor final
//   "items": [ { "productoId": 4, "cantidad": 1 } ],
//   "pago": { "forma": "cuenta_corriente" }
// }
//   contado → pago.montoRecibido, OPCIONAL: si falta, se toma el total
//   tarjeta → pago.tarjeta: { tipo, marca, ultimos4 }
//
// El cliente NUNCA manda precios, subtotales, total, número ni fecha.
// Si pudiera mandar el total, cualquiera compraría por un peso editando
// el pedido.
//
// Pueden facturar admin y vendedor: no hay chequeo de rol.
// Devuelve la factura completa (FacturaCompleta).
// ═════════════════════════════════════════════════════════════
// "any" porque los datos llegan tal cual del JSON, sin validar: el
// trabajo de esta función es justamente revisarlos campo por campo.
export async function crearFactura(usuario: UsuarioSesion, datos: any) {
  // ─────────────────────────────────────────────────────────
  // VALIDAR la estructura del pedido
  // Esto no necesita la base. Si algo está mal, cortamos antes de abrir
  // la transacción.
  // ─────────────────────────────────────────────────────────

  // Campos que no corresponden (total, precios, número, fecha...): 422
  for (const campo of Object.keys(datos)) {
    if (!CAMPOS_PERMITIDOS.includes(campo)) {
      throw errorDeValidacion(campo, `El campo "${campo}" no se puede enviar.`);
    }
  }

  // --- items ---
  if (!Array.isArray(datos.items) || datos.items.length === 0) {
    throw errorDeValidacion('items', 'La factura tiene que tener al menos un ítem.');
  }

  // Armamos "renglones": la lista de ítems con los productos repetidos
  // ya sumados (RF-V3: agregar un producto que ya está suma la cantidad).
  const renglones: { productoId: number; cantidad: number }[] = [];

  for (const item of datos.items) {
    if (typeof item !== 'object' || item === null) {
      throw errorDeValidacion('items', 'Cada ítem tiene que ser un objeto.');
    }
    for (const campo of Object.keys(item)) {
      if (!CAMPOS_PERMITIDOS_ITEM.includes(campo)) {
        throw errorDeValidacion(campo, `El campo "${campo}" no se puede enviar en un ítem.`);
      }
    }
    // Number.isInteger rechaza decimales, textos y null de una vez
    if (!Number.isInteger(item.productoId) || item.productoId <= 0) {
      throw errorDeValidacion('productoId', 'Cada ítem necesita un productoId válido.');
    }
    if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
      throw errorDeValidacion('cantidad', 'La cantidad tiene que ser un entero positivo.');
    }

    const yaEsta = renglones.find((r) => r.productoId === item.productoId);
    if (yaEsta) {
      yaEsta.cantidad = yaEsta.cantidad + item.cantidad;
    } else {
      renglones.push({ productoId: item.productoId, cantidad: item.cantidad });
    }
  }

  // --- pago ---
  const pago = datos.pago;
  if (typeof pago !== 'object' || pago === null || Array.isArray(pago)) {
    throw errorDeValidacion('pago', 'Hay que indicar el pago, por ejemplo { "forma": "contado" }.');
  }
  for (const campo of Object.keys(pago)) {
    if (!CAMPOS_PERMITIDOS_PAGO.includes(campo)) {
      throw errorDeValidacion(`pago.${campo}`, `El campo "pago.${campo}" no se puede enviar.`);
    }
  }

  const formaPago = pago.forma;
  if (formaPago !== 'contado' && formaPago !== 'tarjeta' && formaPago !== 'cuenta_corriente') {
    throw errorDeValidacion('pago.forma', 'La forma de pago tiene que ser contado, tarjeta o cuenta_corriente.');
  }

  // --- clienteId --- (null o ausente = consumidor final)
  let clienteId: number | null = null;
  if (datos.clienteId !== undefined && datos.clienteId !== null) {
    if (!Number.isInteger(datos.clienteId) || datos.clienteId <= 0) {
      throw errorDeValidacion('clienteId', 'El clienteId no es válido.');
    }
    clienteId = datos.clienteId;
  }

  // --- contado: monto recibido ---
  // OPCIONAL (consigna 11.6): si no viene, se asume que pagó justo el
  // total. Si viene, tiene que ser un entero positivo; que alcance para
  // pagar se verifica más abajo, cuando ya tenemos los precios.
  let montoRecibidoInformado: number | null = null;
  if (formaPago === 'contado' && pago.montoRecibido !== undefined && pago.montoRecibido !== null) {
    if (!Number.isInteger(pago.montoRecibido) || pago.montoRecibido <= 0) {
      throw errorDeValidacion('pago.montoRecibido', 'El monto recibido tiene que ser un entero positivo (en centavos).');
    }
    montoRecibidoInformado = pago.montoRecibido;
  }

  // --- tarjeta ---
  // Regla 9: de la tarjeta solo se guardan tipo, marca y últimos 4 dígitos.
  // Como solo aceptamos esos tres campos, el número completo no puede entrar.
  let tarjeta: { tipo: 'debito' | 'credito'; marca: string; ultimos4: string } | null = null;
  if (formaPago === 'tarjeta') {
    const t = pago.tarjeta;
    if (typeof t !== 'object' || t === null) {
      throw errorDeValidacion('pago.tarjeta', 'En pago con tarjeta hay que indicar los datos de la tarjeta.');
    }
    for (const campo of Object.keys(t)) {
      if (!CAMPOS_PERMITIDOS_TARJETA.includes(campo)) {
        throw errorDeValidacion(`pago.tarjeta.${campo}`, `El campo "${campo}" no se puede enviar en la tarjeta.`);
      }
    }
    if (t.tipo !== 'debito' && t.tipo !== 'credito') {
      throw errorDeValidacion('pago.tarjeta.tipo', 'El tipo de tarjeta tiene que ser debito o credito.');
    }
    if (typeof t.marca !== 'string' || t.marca.trim() === '') {
      throw errorDeValidacion('pago.tarjeta.marca', 'La marca de la tarjeta es obligatoria.');
    }
    // /^\d{4}$/ = exactamente 4 dígitos, ni más ni menos
    if (typeof t.ultimos4 !== 'string' || !/^\d{4}$/.test(t.ultimos4)) {
      throw errorDeValidacion('pago.tarjeta.ultimos4', 'Los últimos 4 dígitos tienen que ser exactamente 4 números.');
    }
    tarjeta = { tipo: t.tipo, marca: t.marca.trim(), ultimos4: t.ultimos4 };
  }

  // --- cuenta corriente ---
  // Regla 6: consumidor final no compra en cuenta corriente.
  if (formaPago === 'cuenta_corriente' && clienteId === null) {
    const mensaje = 'Consumidor final no puede comprar en cuenta corriente.';
    throw new ApiError(422, 'CUENTA_CORRIENTE_NO_HABILITADA', mensaje, [{ campo: 'clienteId', mensaje }]);
  }

  // ═════════════════════════════════════════════════════════
  // TRANSACCIÓN — todo lo que sigue pasa entero o no pasa nada
  // (sección 10.8, punto 3: una operación compuesta que falla no deja
  // datos parciales). Si en cualquier punto hay un error (sin stock,
  // límite excedido, se cae la conexión), la base vuelve a como estaba:
  // no queda una factura sin ítems, ni stock descontado sin factura, ni
  // una deuda sin venta.
  //
  // Adentro se usa SIEMPRE "tx" y nunca "db": tx es la conexión que
  // está dentro de la transacción. Si usáramos db, esa consulta quedaría
  // afuera y no se desharía.
  //
  // Para cortar la transacción se LANZA (throw) un ApiError. Drizzle ve
  // el throw, deshace todo (rollback) y lo vuelve a lanzar; la ruta lo
  // atrapa y lo convierte en respuesta con manejarError().
  // ═════════════════════════════════════════════════════════
  const facturaId = await db.transaction(async (tx) => {
    // ─────────────────────────────────────────────────────
    // El cliente (si hay)
    // ─────────────────────────────────────────────────────
    let cliente = null;
    if (clienteId !== null) {
      const filas = await tx.select().from(clientes).where(eq(clientes.id, clienteId));
      cliente = filas[0];

      if (!cliente) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'El cliente no existe.');
      }
      if (!cliente.activo) {
        throw errorDeValidacion('clienteId', 'El cliente está inactivo.');
      }
      // Regla 6: solo un cliente habilitado compra en cuenta corriente
      if (formaPago === 'cuenta_corriente' && !cliente.cuentaCorrienteHabilitada) {
        const mensaje = 'El cliente no tiene cuenta corriente habilitada.';
        throw new ApiError(422, 'CUENTA_CORRIENTE_NO_HABILITADA', mensaje, [{ campo: 'clienteId', mensaje }]);
      }
    }

    // ─────────────────────────────────────────────────────
    // Los productos, todos en una sola consulta
    // inArray = "WHERE id IN (1, 5, 7)"
    // ─────────────────────────────────────────────────────
    const ids = renglones.map((r) => r.productoId);
    const productosEncontrados = await tx.select().from(productos).where(inArray(productos.id, ids));

    for (const renglon of renglones) {
      const producto = productosEncontrados.find((p) => p.id === renglon.productoId);
      if (!producto) {
        throw new ApiError(404, 'NO_ENCONTRADO', `El producto ${renglon.productoId} no existe.`);
      }
      // RF-P3: un producto dado de baja no se vende
      if (!producto.activo) {
        const mensaje = `El producto ${producto.descripcion} está dado de baja.`;
        throw new ApiError(422, 'PRODUCTO_INACTIVO', mensaje, [{ campo: 'productoId', mensaje }]);
      }
    }

    // ─────────────────────────────────────────────────────
    // Calcular importes con los precios DE LA BASE (regla 10: centavos)
    // ─────────────────────────────────────────────────────
    let totalCentavos = 0;
    const detalle = renglones.map((renglon) => {
      // El "!" le dice a TypeScript "esto no es undefined". Es seguro:
      // arriba ya verificamos que cada producto existe.
      const producto = productosEncontrados.find((p) => p.id === renglon.productoId)!;
      const subtotalCentavos = producto.precioCentavos * renglon.cantidad;
      totalCentavos = totalCentavos + subtotalCentavos;
      return { producto, cantidad: renglon.cantidad, subtotalCentavos };
    });

    // RF-V5: en contado, si informó cuánto entregó, tiene que alcanzar.
    // Si no lo informó, se asume que pagó justo el total (consigna 11.6).
    let montoRecibidoCentavos: number | null = null;
    if (formaPago === 'contado') {
      if (montoRecibidoInformado !== null && montoRecibidoInformado < totalCentavos) {
        throw new ApiError(422, 'MONTO_INSUFICIENTE', 'El monto recibido no alcanza para pagar el total.', [
          {
            campo: 'pago.montoRecibido',
            mensaje: `Total: ${totalCentavos} centavos. Recibido: ${montoRecibidoInformado} centavos.`,
          },
        ]);
      }
      montoRecibidoCentavos = montoRecibidoInformado ?? totalCentavos;
    }

    // ─────────────────────────────────────────────────────
    // Límite de crédito (regla 7)
    // Saldo = débitos − créditos, siempre desde movimientos_cuenta.
    // Si el cliente tiene límite, saldo actual + esta venta no puede
    // superarlo. 422: el pedido está bien formado pero rompe una regla.
    // details (AGENTS.md 5.1): saldoActual, limite y excedente.
    // ─────────────────────────────────────────────────────
    if (formaPago === 'cuenta_corriente' && cliente && cliente.limiteCreditoCentavos !== null) {
      const saldoActual = await calcularSaldo(tx, cliente.id);
      const limite = cliente.limiteCreditoCentavos;

      if (saldoActual + totalCentavos > limite) {
        throw new ApiError(422, 'LIMITE_CREDITO_EXCEDIDO', 'La venta supera el límite de crédito del cliente.', [
          { saldoActual, limite, excedente: saldoActual + totalCentavos - limite },
        ]);
      }
    }

    // ─────────────────────────────────────────────────────
    // Stock suficiente para TODOS los renglones (regla 1, RF-V6)
    //
    // Antes de tocar nada revisamos todos los productos y juntamos los
    // que no alcanzan, así el error los lista a TODOS (AGENTS.md 5.1) y
    // no solo el primero: el vendedor corrige todo de una vez.
    //
    // Esta lectura NO reemplaza al UPDATE condicional de moverStock(): es
    // solo para armar un mensaje completo. Si entre esta lectura y el
    // descuento otra venta se llevara las unidades, moverStock() igual lo
    // detecta y corta (punto 4 de la lista de la sección 10.8).
    // ─────────────────────────────────────────────────────
    const faltantes: { productoId: number; solicitado: number; disponible: number }[] = [];
    const nombresFaltantes: string[] = [];
    for (const renglon of detalle) {
      if (renglon.producto.existencia < renglon.cantidad) {
        faltantes.push({
          productoId: renglon.producto.id,
          solicitado: renglon.cantidad,
          disponible: renglon.producto.existencia,
        });
        nombresFaltantes.push(
          `${renglon.producto.descripcion} (hay ${renglon.producto.existencia}, se piden ${renglon.cantidad})`
        );
      }
    }
    if (faltantes.length > 0) {
      throw new ApiError(
        409,
        'STOCK_INSUFICIENTE',
        `No hay stock suficiente para: ${nombresFaltantes.join(', ')}.`,
        faltantes
      );
    }

    // ─────────────────────────────────────────────────────
    // Asignar el número (regla 4)
    // El más alto que existe + 1. Se asigna recién ahora, al confirmar:
    // si la venta falla, la transacción se deshace y el número no se
    // "gasta", así no quedan huecos.
    // ─────────────────────────────────────────────────────
    const [ultima] = await tx
      .select({ maximo: max(facturas.numero) })
      .from(facturas)
      .where(eq(facturas.puntoVenta, PUNTO_VENTA));
    const numero = (ultima.maximo ?? 0) + 1; // ?? 0: si no hay facturas, max da null

    const numeroFormateado = formatearNumeroFactura(PUNTO_VENTA, numero);
    const fecha = new Date().toISOString(); // la fecha la pone el servidor

    // ─────────────────────────────────────────────────────
    // Insertar la factura
    // .returning() devuelve la fila insertada, con el id que le dio la base
    // ─────────────────────────────────────────────────────
    const [factura] = await tx
      .insert(facturas)
      .values({
        puntoVenta: PUNTO_VENTA,
        numero,
        fecha,
        clienteId,
        usuarioId: usuario.id, // regla 11: quién la emitió
        totalCentavos,
        formaPago,
        tarjetaTipo: tarjeta ? tarjeta.tipo : null,
        tarjetaMarca: tarjeta ? tarjeta.marca : null,
        tarjetaUltimos4: tarjeta ? tarjeta.ultimos4 : null,
        montoRecibidoCentavos,
        estado: 'emitida',
      })
      .returning();

    // Renglón por renglón: el ítem y el descuento de stock
    for (const renglon of detalle) {
      const producto = renglon.producto;

      // El renglón de la factura (regla 3)
      // Se COPIAN la descripción y el precio de hoy. Si mañana cambia
      // el precio del catálogo, esta factura sigue mostrando el de hoy.
      await tx.insert(facturaItems).values({
        facturaId: factura.id,
        productoId: producto.id,
        descripcion: producto.descripcion,
        cantidad: renglon.cantidad,
        precioUnitarioCentavos: producto.precioCentavos,
        subtotalCentavos: renglon.subtotalCentavos,
      });

      // Descontar el stock (reglas 1 y 2): cantidad NEGATIVA porque salen
      // unidades. moverStock hace el UPDATE condicional y graba el
      // movimiento; si no alcanza, lanza STOCK_INSUFICIENTE y se deshace
      // TODO, incluida la factura y los renglones ya insertados.
      await moverStock(tx, {
        productoId: producto.id,
        tipo: 'venta',
        cantidad: -renglon.cantidad,
        motivo: `Venta ${numeroFormateado}`,
        fecha,
        usuarioId: usuario.id,
        facturaId: factura.id,
      });
    }

    // ─────────────────────────────────────────────────────
    // Deuda en cuenta corriente
    // La venta a cuenta es un DÉBITO: aumenta lo que debe el cliente.
    // ─────────────────────────────────────────────────────
    if (formaPago === 'cuenta_corriente' && cliente) {
      await tx.insert(movimientosCuenta).values({
        clienteId: cliente.id,
        tipo: 'debito',
        importeCentavos: totalCentavos,
        fecha,
        descripcion: `Factura ${numeroFormateado}`,
        facturaId: factura.id,
      });
    }

    // Si llegamos acá sin ningún throw, Drizzle confirma (commit).
    return factura.id;
  });

  // Devolvemos la factura con EXACTAMENTE la misma forma que el detalle
  // (consigna 11.6), leída después del commit. Así hay un solo lugar que
  // arma la respuesta: obtenerFactura().
  return await obtenerFactura(usuario, String(facturaId));
}

// ═════════════════════════════════════════════════════════════
// listarFacturas — listado con filtros y paginación (RF-V8)
//
// Filtros opcionales y combinables (todos llegan como texto o null),
// con los nombres de la consigna 11.6:
//   q              número de comprobante ("42" o "0001-00000042") O
//                  parte del nombre del cliente
//   desde, hasta   fechas AAAA-MM-DD (días de Argentina, ambos incluidos)
//   clienteId      número
//   vendedorId     número (el usuario que la emitió)
//   forma          contado | tarjeta | cuenta_corriente
//   estado         emitida | anulada
//   page           desde 1 (por defecto 1)
//   pageSize       de 1 a 100 (por defecto 20)
//
// Devuelve { data, page, pageSize, total, totalEmitido } (sección 11.1
// más totalEmitido de la 11.6).
// Los dos roles pueden consultar: no hay chequeo de rol.
// ═════════════════════════════════════════════════════════════
type FiltrosFacturas = {
  q: string | null;
  desde: string | null;
  hasta: string | null;
  clienteId: string | null;
  vendedorId: string | null;
  forma: string | null;
  estado: string | null;
  page: string | null;
  pageSize: string | null;
};

export async function listarFacturas(usuario: UsuarioSesion, filtros: FiltrosFacturas) {
  // Vamos juntando una condición por cada filtro que vino.
  // Al final se combinan todas con AND. Si no vino ninguno, la lista
  // queda vacía y se devuelven todas las facturas.
  const condiciones: SQL[] = [];

  // --- q: número O nombre del cliente ---
  // Siempre busca en el nombre del cliente (sin distinguir mayúsculas).
  // Si además el texto parece un número ("42" o "0001-00000042"), busca
  // también por número de comprobante. Las dos opciones se unen con OR.
  if (filtros.q !== null) {
    const texto = filtros.q.trim();
    const opciones: SQL[] = [like(sql`lower(${clientes.nombre})`, `%${texto.toLowerCase()}%`)];

    // Nos quedamos con lo que está después del último guion: "00000042" → 42
    const partes = texto.split('-');
    const n = Number(partes[partes.length - 1]);
    if (Number.isInteger(n) && n > 0) {
      opciones.push(eq(facturas.numero, n));
    }
    // El "!" es seguro: "opciones" siempre tiene al menos un elemento
    condiciones.push(or(...opciones)!);
  }

  // --- Fechas ---
  // Las fechas se guardan en UTC (hora de Londres), pero el usuario
  // piensa en días de Argentina (UTC−3, sección 11.1). Una venta del
  // 21/11 a las 22:00 en Tucumán se guarda como "2026-11-22T01:00:00Z".
  // Por eso convertimos el día pedido a su comienzo en hora argentina:
  //   desde=2026-11-21 → desde las 00:00 del 21 en Argentina
  //   hasta=2026-11-21 → hasta ANTES de las 00:00 del 22 en Argentina
  // Así "hasta" incluye el día completo.
  const UN_DIA_MS = 24 * 60 * 60 * 1000;
  const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

  if (filtros.desde !== null) {
    const inicio = new Date(filtros.desde + 'T00:00:00-03:00');
    if (!FORMATO_FECHA.test(filtros.desde) || isNaN(inicio.getTime())) {
      throw errorDeValidacion('desde', 'La fecha "desde" tiene que tener el formato AAAA-MM-DD.');
    }
    // Las fechas ISO se pueden comparar como texto: "2026-11-21..." < "2026-11-22..."
    condiciones.push(gte(facturas.fecha, inicio.toISOString()));
  }

  if (filtros.hasta !== null) {
    const inicioDelDia = new Date(filtros.hasta + 'T00:00:00-03:00');
    if (!FORMATO_FECHA.test(filtros.hasta) || isNaN(inicioDelDia.getTime())) {
      throw errorDeValidacion('hasta', 'La fecha "hasta" tiene que tener el formato AAAA-MM-DD.');
    }
    const inicioDelDiaSiguiente = new Date(inicioDelDia.getTime() + UN_DIA_MS);
    condiciones.push(lt(facturas.fecha, inicioDelDiaSiguiente.toISOString()));
  }

  // --- clienteId ---
  if (filtros.clienteId !== null) {
    const id = Number(filtros.clienteId);
    if (!Number.isInteger(id) || id <= 0) {
      throw errorDeValidacion('clienteId', 'El clienteId no es válido.');
    }
    condiciones.push(eq(facturas.clienteId, id));
  }

  // --- vendedorId ---
  if (filtros.vendedorId !== null) {
    const id = Number(filtros.vendedorId);
    if (!Number.isInteger(id) || id <= 0) {
      throw errorDeValidacion('vendedorId', 'El vendedorId no es válido.');
    }
    condiciones.push(eq(facturas.usuarioId, id));
  }

  // --- forma (de pago) ---
  const forma = filtros.forma;
  if (forma !== null) {
    if (forma !== 'contado' && forma !== 'tarjeta' && forma !== 'cuenta_corriente') {
      throw errorDeValidacion('forma', 'La forma de pago tiene que ser contado, tarjeta o cuenta_corriente.');
    }
    condiciones.push(eq(facturas.formaPago, forma));
  }

  // --- estado ---
  const estado = filtros.estado;
  if (estado !== null) {
    if (estado !== 'emitida' && estado !== 'anulada') {
      throw errorDeValidacion('estado', 'El estado tiene que ser emitida o anulada.');
    }
    condiciones.push(eq(facturas.estado, estado));
  }

  // --- Paginación (sección 11.1) ---
  // page desde 1; pageSize por defecto 20 y máximo 100.
  let page = 1;
  if (filtros.page !== null) {
    page = Number(filtros.page);
    if (!Number.isInteger(page) || page < 1) {
      throw errorDeValidacion('page', 'La página tiene que ser un entero desde 1.');
    }
  }
  let pageSize = 20;
  if (filtros.pageSize !== null) {
    pageSize = Number(filtros.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw errorDeValidacion('pageSize', 'El tamaño de página tiene que ser un entero entre 1 y 100.');
    }
  }

  // --- Totales: cuántas facturas cumplen los filtros, y cuánto suman
  //     las EMITIDAS (las anuladas no cuentan como venta) ---
  // count() = "SELECT COUNT(*)".
  // CASE WHEN ... THEN ... ELSE 0 END = "si está emitida, sumá su total;
  //   si no, sumá 0". coalesce(..., 0): si no hay ninguna, da 0 y no null.
  // El JOIN con clientes hace falta porque el filtro q busca en su nombre.
  const [totales] = await db
    .select({
      total: count(),
      totalEmitido: sql<number>`coalesce(sum(case when ${facturas.estado} = 'emitida' then ${facturas.totalCentavos} else 0 end), 0)`.mapWith(
        Number
      ),
    })
    .from(facturas)
    .leftJoin(clientes, eq(facturas.clienteId, clientes.id))
    .where(and(...condiciones));

  // --- La página pedida ---
  // JOIN = "pegar" a cada factura datos de otra tabla.
  //   leftJoin clientes: trae el nombre del cliente. Es LEFT porque el
  //     consumidor final no tiene cliente (clienteId null): sin LEFT,
  //     esas facturas desaparecerían del listado.
  //   innerJoin usuarios: trae el nombre del vendedor. Toda factura
  //     tiene vendedor. Del usuario pedimos SOLO id y nombre.
  // limit = cuántas traer; offset = cuántas saltear.
  //   page 1 → saltea 0;  page 2 → saltea 20;  page 3 → saltea 40
  const filas = await db
    .select({
      factura: facturas,
      cliente: { id: clientes.id, nombre: clientes.nombre },
      vendedor: { id: usuarios.id, nombre: usuarios.nombre },
    })
    .from(facturas)
    .leftJoin(clientes, eq(facturas.clienteId, clientes.id))
    .innerJoin(usuarios, eq(facturas.usuarioId, usuarios.id))
    .where(and(...condiciones))
    // Las más nuevas primero. Si dos tienen la misma fecha, decide el número.
    .orderBy(desc(facturas.fecha), desc(facturas.numero))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  // Cada factura del listado, con los mismos nombres de campo que el
  // detalle (consigna 11.6), pero sin ítems.
  const data = filas.map((f) => ({
    id: f.factura.id,
    puntoVenta: f.factura.puntoVenta,
    numero: f.factura.numero,
    numeroFormateado: formatearNumeroFactura(f.factura.puntoVenta, f.factura.numero),
    fecha: f.factura.fecha,
    estado: f.factura.estado,
    cliente: f.cliente, // null = consumidor final
    vendedor: f.vendedor,
    total: f.factura.totalCentavos,
    pago: { forma: f.factura.formaPago },
  }));

  return { data, page, pageSize, total: totales.total, totalEmitido: totales.totalEmitido };
}

// ═════════════════════════════════════════════════════════════
// proximoNumero — qué número saldría si se facturara ahora (RF-V4)
//
// Es INFORMATIVO: sirve para mostrarlo en la pantalla de nueva venta
// antes de confirmar. El número que vale se asigna adentro de la
// transacción de crearFactura(), porque entre esta consulta y la venta
// puede entrar otra factura y correr el número.
//
// Si dos vendedores consultan al mismo tiempo, los dos ven el mismo
// número, y está bien: solo el que confirme primero se lo queda. Que no
// se repita lo garantiza el índice único sobre (punto_venta, numero),
// no esta consulta.
//
// No recibe el usuario porque no aplica ninguna regla que dependa de
// él: los dos roles pueden consultarlo. La ruta igual exige sesión.
// ═════════════════════════════════════════════════════════════
export async function proximoNumero() {
  // El número más alto de este punto de venta, + 1.
  // "?? 0": si todavía no hay ninguna factura, max devuelve null.
  const [ultima] = await db
    .select({ maximo: max(facturas.numero) })
    .from(facturas)
    .where(eq(facturas.puntoVenta, PUNTO_VENTA));

  const numero = (ultima.maximo ?? 0) + 1;

  return {
    puntoVenta: PUNTO_VENTA,
    numero,
    numeroFormateado: formatearNumeroFactura(PUNTO_VENTA, numero),
  };
}

// ═════════════════════════════════════════════════════════════
// obtenerFactura — el comprobante completo (RF-V7)
//
// id llega como texto desde la URL. Los dos roles pueden consultar.
// Devuelve la forma de la consigna 11.6 (FacturaCompleta).
// ═════════════════════════════════════════════════════════════
export async function obtenerFactura(usuario: UsuarioSesion, id: string): Promise<FacturaCompleta> {
  // Si no es un número entero positivo ("abc", "1.5"), esa factura no
  // puede existir: 404.
  const facturaId = Number(id);
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'La factura no existe.');
  }

  // ─────────────────────────────────────────────────────────
  // La cabecera, con el cliente y el vendedor en una sola consulta.
  // leftJoin clientes: el consumidor final no tiene cliente; en ese
  //   caso "cliente" viene null.
  // innerJoin usuarios: del vendedor pedimos SOLO id y nombre
  //   (nunca la fila entera, que tiene el hash de la contraseña).
  // ─────────────────────────────────────────────────────────
  const filas = await db
    .select({
      factura: facturas,
      cliente: {
        id: clientes.id,
        nombre: clientes.nombre,
        tipoDocumento: clientes.tipoDocumento,
        numeroDocumento: clientes.numeroDocumento,
        domicilio: clientes.domicilio,
      },
      vendedor: { id: usuarios.id, nombre: usuarios.nombre },
    })
    .from(facturas)
    .leftJoin(clientes, eq(facturas.clienteId, clientes.id))
    .innerJoin(usuarios, eq(facturas.usuarioId, usuarios.id))
    .where(eq(facturas.id, facturaId));

  const fila = filas[0];
  if (!fila) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'La factura no existe.');
  }
  const factura = fila.factura;

  // ─────────────────────────────────────────────────────────
  // Los renglones. Descripción y precio salen de factura_items, que
  // guarda la COPIA del momento de la venta (regla 3), no del
  // catálogo actual. El código sí sale del producto (la factura no lo
  // copia): por eso el JOIN con productos.
  // ─────────────────────────────────────────────────────────
  const items = await db
    .select({ item: facturaItems, codigo: productos.codigo })
    .from(facturaItems)
    .innerJoin(productos, eq(facturaItems.productoId, productos.id))
    .where(eq(facturaItems.facturaId, factura.id))
    .orderBy(facturaItems.id);

  // ─────────────────────────────────────────────────────────
  // El pago, según la forma (consigna 11.6)
  // ─────────────────────────────────────────────────────────
  let pago: FacturaCompleta['pago'];
  if (factura.formaPago === 'contado') {
    // Las facturas viejas siempre tienen monto; por las dudas, si falta,
    // se toma el total (pagó justo)
    const montoRecibido = factura.montoRecibidoCentavos ?? factura.totalCentavos;
    pago = { forma: 'contado', montoRecibido, vuelto: montoRecibido - factura.totalCentavos };
  } else if (factura.formaPago === 'tarjeta') {
    pago = {
      forma: 'tarjeta',
      tarjeta: { tipo: factura.tarjetaTipo, marca: factura.tarjetaMarca, ultimos4: factura.tarjetaUltimos4 },
    };
  } else {
    pago = { forma: 'cuenta_corriente' };
  }

  // ─────────────────────────────────────────────────────────
  // El resultado, con los nombres de la consigna 11.6
  // ─────────────────────────────────────────────────────────
  const resultado: FacturaCompleta = {
    id: factura.id,
    puntoVenta: factura.puntoVenta,
    numero: factura.numero,
    numeroFormateado: formatearNumeroFactura(factura.puntoVenta, factura.numero),
    fecha: factura.fecha,
    estado: factura.estado,
    cliente: fila.cliente
      ? {
          id: fila.cliente.id,
          nombre: fila.cliente.nombre,
          tipoDoc: fila.cliente.tipoDocumento,
          nroDoc: fila.cliente.numeroDocumento, // sin puntos: la pantalla lo formatea
          domicilio: fila.cliente.domicilio,
        }
      : null,
    vendedor: fila.vendedor,
    items: items.map((fila) => ({
      productoId: fila.item.productoId,
      codigo: fila.codigo,
      descripcion: fila.item.descripcion,
      cantidad: fila.item.cantidad,
      precioUnitario: fila.item.precioUnitarioCentavos,
      subtotal: fila.item.subtotalCentavos,
    })),
    total: factura.totalCentavos,
    pago,
  };

  // saldoCliente: SOLO en ventas a cuenta corriente. Es el saldo ACTUAL
  // del cliente (regla 7), calculado desde movimientos_cuenta.
  if (factura.formaPago === 'cuenta_corriente' && factura.clienteId !== null) {
    resultado.saldoCliente = await calcularSaldo(db, factura.clienteId);
  }

  // anulacion: SOLO si está anulada, con fecha, quién y por qué (RF-V9)
  if (factura.estado === 'anulada') {
    let quienAnulo = null;
    if (factura.anuladaPorId !== null) {
      const [u] = await db
        .select({ id: usuarios.id, nombre: usuarios.nombre })
        .from(usuarios)
        .where(eq(usuarios.id, factura.anuladaPorId));
      quienAnulo = u ?? null;
    }
    resultado.anulacion = {
      fecha: factura.anuladaEn ?? '',
      usuario: quienAnulo,
      motivo: factura.motivoAnulacion ?? '',
    };
  }

  return resultado;
}

// ═════════════════════════════════════════════════════════════
// anularFactura — anular una factura (RF-V9)
//
// datos (sin validar): { "motivo": "Error de carga" }
//
// Regla 5: una factura confirmada no se modifica, solo se anula, y la
// anulación revierte el stock y el saldo.
// Regla 12: bajas lógicas. La factura NUNCA se borra: queda visible con
// estado 'anulada', su motivo, cuándo y quién la anuló.
// ═════════════════════════════════════════════════════════════
export async function anularFactura(usuario: UsuarioSesion, id: string, datos: any) {
  // ─────────────────────────────────────────────────────────
  // PERMISO — solo el administrador anula (sección 10.8, punto 2).
  // Un vendedor que llame a la ruta directamente (con curl, sin pasar
  // por la pantalla) recibe 403. Ocultar el botón en la interfaz no es
  // seguridad: el control real es este if, en el servidor.
  // Va primero, antes de validar, para no darle información a quien no
  // tiene permiso.
  // ─────────────────────────────────────────────────────────
  if (usuario.rol !== 'admin') {
    throw new ApiError(403, 'SIN_PERMISO', 'Solo un administrador puede anular facturas.');
  }

  // El id de la URL. Si no es un entero positivo, no puede existir: 404.
  const facturaId = Number(id);
  if (!Number.isInteger(facturaId) || facturaId <= 0) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'La factura no existe.');
  }

  // ─────────────────────────────────────────────────────────
  // VALIDAR — el motivo es obligatorio
  // ─────────────────────────────────────────────────────────
  // Igual que al facturar: solo se acepta el campo esperado
  for (const campo of Object.keys(datos)) {
    if (campo !== 'motivo') {
      throw errorDeValidacion(campo, `El campo "${campo}" no se puede enviar.`);
    }
  }
  if (typeof datos.motivo !== 'string' || datos.motivo.trim() === '') {
    throw errorDeValidacion('motivo', 'El motivo de anulación es obligatorio.');
  }
  const motivo = datos.motivo.trim();

  // ═════════════════════════════════════════════════════════
  // TRANSACCIÓN
  // Marcar la factura, devolver el stock y acreditar la cuenta pasan
  // todos juntos o no pasa ninguno. Nunca puede quedar una factura
  // anulada con el stock sin devolver, ni al revés.
  // Adentro se usa tx, nunca db. Para cortar: throw.
  // ═════════════════════════════════════════════════════════
  await db.transaction(async (tx) => {
    // ─────────────────────────────────────────────────────
    // Traer la factura
    // ─────────────────────────────────────────────────────
    const filas = await tx.select().from(facturas).where(eq(facturas.id, facturaId));
    const factura = filas[0];
    if (!factura) {
      throw new ApiError(404, 'NO_ENCONTRADO', 'La factura no existe.');
    }

    const numeroFormateado = formatearNumeroFactura(factura.puntoVenta, factura.numero);

    // ─────────────────────────────────────────────────────
    // No anular dos veces
    // Si se pudiera, el stock se devolvería dos veces y la deuda del
    // cliente se acreditaría dos veces. 409: choca con el estado actual.
    // ─────────────────────────────────────────────────────
    if (factura.estado === 'anulada') {
      throw new ApiError(409, 'FACTURA_ANULADA', `La factura ${numeroFormateado} ya está anulada.`);
    }

    // ─────────────────────────────────────────────────────
    // Marcar la factura como anulada (no se borra, regla 12)
    //
    // Es un UPDATE CONDICIONAL, con la misma idea que moverStock:
    //
    //   UPDATE facturas SET estado = 'anulada', ...
    //   WHERE id = 52 AND estado = 'emitida'
    //
    // El paso anterior ya verificó el estado, pero entre esa lectura y
    // este UPDATE podría colarse otra anulación de la misma factura. Con
    // "AND estado = 'emitida'" en el WHERE, solo la primera la encuentra;
    // la segunda modifica CERO filas y se corta acá, antes de devolver
    // stock.
    // ─────────────────────────────────────────────────────
    // La fecha la pone el servidor. Una sola, para la factura y para
    // todos los movimientos de esta anulación.
    const fecha = new Date().toISOString();

    const anuladas = await tx
      .update(facturas)
      .set({
        estado: 'anulada',
        motivoAnulacion: motivo,
        anuladaEn: fecha,
        anuladaPorId: usuario.id, // regla 11: quién la anuló
      })
      .where(and(eq(facturas.id, factura.id), eq(facturas.estado, 'emitida')))
      .returning({ id: facturas.id });

    if (anuladas.length === 0) {
      throw new ApiError(409, 'FACTURA_ANULADA', `La factura ${numeroFormateado} ya está anulada.`);
    }

    // ─────────────────────────────────────────────────────
    // Devolver el stock, renglón por renglón (regla 5)
    // Cantidad POSITIVA porque entran unidades: la venta había grabado
    // -2 y la anulación graba +2, así la suma de movimientos sigue
    // dando la existencia (regla 2). moverStock suma sin condición.
    // ─────────────────────────────────────────────────────
    const items = await tx.select().from(facturaItems).where(eq(facturaItems.facturaId, factura.id));

    for (const item of items) {
      await moverStock(tx, {
        productoId: item.productoId,
        tipo: 'anulacion',
        cantidad: item.cantidad,
        motivo: `Anulación de ${numeroFormateado}`,
        fecha,
        usuarioId: usuario.id,
        facturaId: factura.id,
      });
    }

    // ─────────────────────────────────────────────────────
    // Revertir la deuda (regla 5)
    // La venta a cuenta había generado un DÉBITO por el total.
    // La anulación genera un CRÉDITO por el mismo total, y como
    // saldo = débitos − créditos (regla 7), se cancelan.
    // No se valida el límite de crédito: un crédito siempre BAJA el
    // saldo, nunca lo puede pasar del límite.
    // El débito original NO se borra: queda en el historial, y al lado
    // el crédito que lo compensa.
    // ─────────────────────────────────────────────────────
    if (factura.formaPago === 'cuenta_corriente' && factura.clienteId !== null) {
      await tx.insert(movimientosCuenta).values({
        clienteId: factura.clienteId,
        tipo: 'credito',
        importeCentavos: factura.totalCentavos,
        fecha,
        descripcion: `Anulación de ${numeroFormateado}`,
        facturaId: factura.id,
      });
    }
    // Si llegamos acá sin ningún throw, Drizzle confirma (commit).
  });

  // Devolvemos la factura ya anulada con EXACTAMENTE la misma forma que
  // el detalle (con su "anulacion"). Se lee después del commit, así trae
  // los datos ya confirmados.
  return await obtenerFactura(usuario, id);
}
