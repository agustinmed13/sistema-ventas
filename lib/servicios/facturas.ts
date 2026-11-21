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

import { eq, and, gte, lt, inArray, max, desc, count, type SQL } from 'drizzle-orm';
import { db } from '@/db/index';
import { usuarios, clientes, productos, facturas, facturaItems, movimientosCuenta } from '@/db/schema';
import { ApiError } from '@/lib/errores';
import { moverStock } from '@/lib/servicios/stock';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual)
export type UsuarioSesion = { id: number; nombre: string; rol: 'admin' | 'vendedor' };

// Por ahora hay un solo punto de venta
const PUNTO_VENTA = 1;

// Los únicos campos que el cliente puede mandar al facturar. Cualquier
// otro (total, precio, numero, fecha...) se rechaza con 422: los precios,
// el total, el número y la fecha los asigna el servidor (sección 11.1).
const CAMPOS_PERMITIDOS = ['clienteId', 'formaPago', 'items', 'montoRecibidoCentavos', 'tarjeta'];
const CAMPOS_PERMITIDOS_ITEM = ['productoId', 'cantidad'];
const CAMPOS_PERMITIDOS_TARJETA = ['tipo', 'marca', 'ultimos4'];

// Un error 422 VALIDACION sobre un campo, con el formato de "details"
// de la sección 11.1: [{ campo, mensaje }]
function errorDeValidacion(campo: string, mensaje: string) {
  return new ApiError(422, 'VALIDACION', mensaje, [{ campo, mensaje }]);
}

// 1, 42 → "0001-00000042" (regla 4)
// TEMPORAL: según la sección 6 del AGENTS.md esto va en lib/formato.ts,
// que todavía no existe. Cuando exista, se usa la de ahí.
function formatearNumero(puntoVenta: number, numero: number) {
  // padStart rellena con ceros a la izquierda
  return String(puntoVenta).padStart(4, '0') + '-' + String(numero).padStart(8, '0');
}

// ═════════════════════════════════════════════════════════════
// crearFactura — emitir una factura (RF-V1 a RF-V6)
//
// datos (sin validar):
// {
//   "clienteId": 3,                     // null = consumidor final
//   "formaPago": "cuenta_corriente",    // contado | tarjeta | cuenta_corriente
//   "items": [ { "productoId": 1, "cantidad": 2 } ],
//   "montoRecibidoCentavos": 2000000,   // solo si es contado
//   "tarjeta": { "tipo": "credito", "marca": "Visa", "ultimos4": "1234" }
// }
//
// El cliente NUNCA manda precios, subtotales, total, número ni fecha.
// Si pudiera mandar el total, cualquiera compraría por un peso editando
// el pedido.
//
// Pueden facturar admin y vendedor: no hay chequeo de rol.
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

  // --- formaPago ---
  const formaPago = datos.formaPago;
  if (formaPago !== 'contado' && formaPago !== 'tarjeta' && formaPago !== 'cuenta_corriente') {
    throw errorDeValidacion('formaPago', 'La forma de pago tiene que ser contado, tarjeta o cuenta_corriente.');
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
  // Acá solo verificamos que sea un entero positivo. Que alcance para
  // pagar el total se verifica más abajo, cuando ya tenemos los precios.
  let montoRecibidoCentavos: number | null = null;
  if (formaPago === 'contado') {
    if (!Number.isInteger(datos.montoRecibidoCentavos) || datos.montoRecibidoCentavos <= 0) {
      throw errorDeValidacion(
        'montoRecibidoCentavos',
        'En contado hay que indicar el monto recibido (entero positivo).'
      );
    }
    montoRecibidoCentavos = datos.montoRecibidoCentavos;
  }

  // --- tarjeta ---
  // Regla 9: de la tarjeta solo se guardan tipo, marca y últimos 4 dígitos.
  // Como solo aceptamos esos tres campos, el número completo no puede entrar.
  let tarjeta: { tipo: 'debito' | 'credito'; marca: string; ultimos4: string } | null = null;
  if (formaPago === 'tarjeta') {
    const t = datos.tarjeta;
    if (typeof t !== 'object' || t === null) {
      throw errorDeValidacion('tarjeta', 'En pago con tarjeta hay que indicar los datos de la tarjeta.');
    }
    for (const campo of Object.keys(t)) {
      if (!CAMPOS_PERMITIDOS_TARJETA.includes(campo)) {
        throw errorDeValidacion(campo, `El campo "${campo}" no se puede enviar en la tarjeta.`);
      }
    }
    if (t.tipo !== 'debito' && t.tipo !== 'credito') {
      throw errorDeValidacion('tarjeta.tipo', 'El tipo de tarjeta tiene que ser debito o credito.');
    }
    if (typeof t.marca !== 'string' || t.marca.trim() === '') {
      throw errorDeValidacion('tarjeta.marca', 'La marca de la tarjeta es obligatoria.');
    }
    // /^\d{4}$/ = exactamente 4 dígitos, ni más ni menos
    if (typeof t.ultimos4 !== 'string' || !/^\d{4}$/.test(t.ultimos4)) {
      throw errorDeValidacion('tarjeta.ultimos4', 'Los últimos 4 dígitos tienen que ser exactamente 4 números.');
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
  return await db.transaction(async (tx) => {
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

    // RF-V5: en contado, lo recibido tiene que alcanzar para pagar
    if (montoRecibidoCentavos !== null && montoRecibidoCentavos < totalCentavos) {
      throw new ApiError(422, 'MONTO_INSUFICIENTE', 'El monto recibido no alcanza para pagar el total.', [
        {
          campo: 'montoRecibidoCentavos',
          mensaje: `Total: ${totalCentavos} centavos. Recibido: ${montoRecibidoCentavos} centavos.`,
        },
      ]);
    }

    // ─────────────────────────────────────────────────────
    // Límite de crédito (regla 7)
    // Saldo = débitos − créditos, siempre desde movimientos_cuenta.
    // Si el cliente tiene límite, saldo actual + esta venta no puede
    // superarlo. 422: el pedido está bien formado pero rompe una regla.
    // ─────────────────────────────────────────────────────
    if (formaPago === 'cuenta_corriente' && cliente && cliente.limiteCreditoCentavos !== null) {
      const movimientos = await tx
        .select()
        .from(movimientosCuenta)
        .where(eq(movimientosCuenta.clienteId, cliente.id));

      let saldoCentavos = 0;
      for (const mov of movimientos) {
        if (mov.tipo === 'debito') {
          saldoCentavos = saldoCentavos + mov.importeCentavos;
        } else {
          saldoCentavos = saldoCentavos - mov.importeCentavos;
        }
      }

      if (saldoCentavos + totalCentavos > cliente.limiteCreditoCentavos) {
        throw new ApiError(422, 'LIMITE_CREDITO_EXCEDIDO', 'La venta supera el límite de crédito del cliente.', [
          {
            campo: 'clienteId',
            mensaje:
              `Límite: ${cliente.limiteCreditoCentavos} centavos. ` +
              `Saldo actual: ${saldoCentavos} centavos. Esta venta: ${totalCentavos} centavos.`,
          },
        ]);
      }
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

    const numeroFormateado = formatearNumero(PUNTO_VENTA, numero);
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

    // ─────────────────────────────────────────────────────
    // El resultado. Lo que devuelve esta función es lo que devuelve
    // db.transaction. Si llegamos acá sin ningún throw, Drizzle confirma
    // (commit).
    // Es la MISMA forma que devuelve obtenerFactura(), así la pantalla
    // usa una sola estructura para el comprobante.
    // ─────────────────────────────────────────────────────
    return {
      id: factura.id,
      numero: numeroFormateado,
      fecha: factura.fecha,
      estado: factura.estado,
      // Recién emitida nunca está anulada; van para mantener la forma
      motivoAnulacion: null,
      anuladaEn: null,
      formaPago: factura.formaPago,
      totalCentavos: factura.totalCentavos,
      montoRecibidoCentavos: factura.montoRecibidoCentavos,
      // Vuelto solo en contado
      vueltoCentavos: montoRecibidoCentavos !== null ? montoRecibidoCentavos - totalCentavos : null,
      tarjeta: tarjeta,
      // Para mostrar directo: el nombre, o "Consumidor final"
      clienteNombre: cliente ? cliente.nombre : 'Consumidor final',
      cliente: cliente
        ? {
            id: cliente.id,
            nombre: cliente.nombre,
            tipoDocumento: cliente.tipoDocumento,
            numeroDocumento: cliente.numeroDocumento,
          }
        : null,
      usuario: { id: usuario.id, nombre: usuario.nombre },
      items: detalle.map((renglon) => ({
        productoId: renglon.producto.id,
        descripcion: renglon.producto.descripcion,
        cantidad: renglon.cantidad,
        precioUnitarioCentavos: renglon.producto.precioCentavos,
        subtotalCentavos: renglon.subtotalCentavos,
      })),
    };
  });
}

// ═════════════════════════════════════════════════════════════
// listarFacturas — listado con filtros y paginación (RF-V8)
//
// Filtros opcionales y combinables (todos llegan como texto o null):
//   desde, hasta   fechas AAAA-MM-DD (días de Argentina, ambos incluidos)
//   clienteId      número
//   formaPago      contado | tarjeta | cuenta_corriente
//   usuarioId      número (el vendedor que la emitió)
//   numero         "42" o "0001-00000042"
//   estado         emitida | anulada
//   page           desde 1 (por defecto 1)
//   pageSize       de 1 a 100 (por defecto 20)
//
// Devuelve { data, page, pageSize, total } (sección 11.1).
// Los dos roles pueden consultar: no hay chequeo de rol.
// ═════════════════════════════════════════════════════════════
type FiltrosFacturas = {
  desde: string | null;
  hasta: string | null;
  clienteId: string | null;
  formaPago: string | null;
  usuarioId: string | null;
  numero: string | null;
  estado: string | null;
  page: string | null;
  pageSize: string | null;
};

export async function listarFacturas(usuario: UsuarioSesion, filtros: FiltrosFacturas) {
  // Vamos juntando una condición por cada filtro que vino.
  // Al final se combinan todas con AND. Si no vino ninguno, la lista
  // queda vacía y se devuelven todas las facturas.
  const condiciones: SQL[] = [];

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

  // --- formaPago ---
  const formaPago = filtros.formaPago;
  if (formaPago !== null) {
    if (formaPago !== 'contado' && formaPago !== 'tarjeta' && formaPago !== 'cuenta_corriente') {
      throw errorDeValidacion('formaPago', 'La forma de pago tiene que ser contado, tarjeta o cuenta_corriente.');
    }
    condiciones.push(eq(facturas.formaPago, formaPago));
  }

  // --- usuarioId (vendedor) ---
  if (filtros.usuarioId !== null) {
    const id = Number(filtros.usuarioId);
    if (!Number.isInteger(id) || id <= 0) {
      throw errorDeValidacion('usuarioId', 'El usuarioId no es válido.');
    }
    condiciones.push(eq(facturas.usuarioId, id));
  }

  // --- numero ---
  // Acepta "42" o "0001-00000042". Nos quedamos con lo que está después
  // del último guion y lo pasamos a número: "00000042" → 42.
  if (filtros.numero !== null) {
    const partes = filtros.numero.trim().split('-');
    const n = Number(partes[partes.length - 1]);
    if (!Number.isInteger(n) || n <= 0) {
      throw errorDeValidacion('numero', 'El número de comprobante no es válido.');
    }
    condiciones.push(eq(facturas.numero, n));
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

  // --- El total: cuántas facturas cumplen los filtros, sin paginar ---
  // count() = "SELECT COUNT(*)". La pantalla lo usa para saber cuántas
  // páginas hay.
  const [conteo] = await db
    .select({ total: count() })
    .from(facturas)
    .where(and(...condiciones));

  // --- La página pedida ---
  // JOIN = "pegar" a cada factura datos de otra tabla.
  //   leftJoin clientes: trae el nombre del cliente. Es LEFT porque el
  //     consumidor final no tiene cliente (clienteId null): sin LEFT,
  //     esas facturas desaparecerían del listado.
  //   innerJoin usuarios: trae el nombre del vendedor. Toda factura
  //     tiene vendedor. Del usuario pedimos SOLO el nombre.
  // limit = cuántas traer; offset = cuántas saltear.
  //   page 1 → saltea 0;  page 2 → saltea 20;  page 3 → saltea 40
  const filas = await db
    .select({
      id: facturas.id,
      puntoVenta: facturas.puntoVenta,
      numero: facturas.numero,
      fecha: facturas.fecha,
      estado: facturas.estado,
      formaPago: facturas.formaPago,
      totalCentavos: facturas.totalCentavos,
      clienteNombre: clientes.nombre,
      vendedorNombre: usuarios.nombre,
    })
    .from(facturas)
    .leftJoin(clientes, eq(facturas.clienteId, clientes.id))
    .innerJoin(usuarios, eq(facturas.usuarioId, usuarios.id))
    .where(and(...condiciones))
    // Las más nuevas primero. Si dos tienen la misma fecha, decide el número.
    .orderBy(desc(facturas.fecha), desc(facturas.numero))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const data = filas.map((f) => ({
    id: f.id,
    numero: formatearNumero(f.puntoVenta, f.numero),
    fecha: f.fecha,
    estado: f.estado,
    formaPago: f.formaPago,
    totalCentavos: f.totalCentavos,
    clienteNombre: f.clienteNombre ?? 'Consumidor final', // ?? = "si es null, usá esto"
    vendedorNombre: f.vendedorNombre,
  }));

  return { data, page, pageSize, total: conteo.total };
}

// ═════════════════════════════════════════════════════════════
// obtenerFactura — el comprobante completo (RF-V7)
//
// id llega como texto desde la URL. Los dos roles pueden consultar.
// ═════════════════════════════════════════════════════════════
export async function obtenerFactura(usuario: UsuarioSesion, id: string) {
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
  // catálogo actual.
  // ─────────────────────────────────────────────────────────
  const items = await db
    .select()
    .from(facturaItems)
    .where(eq(facturaItems.facturaId, factura.id))
    .orderBy(facturaItems.id);

  // ─────────────────────────────────────────────────────────
  // El resultado. Es la MISMA forma que devuelve crearFactura().
  // ─────────────────────────────────────────────────────────
  let vueltoCentavos = null;
  if (factura.formaPago === 'contado' && factura.montoRecibidoCentavos !== null) {
    vueltoCentavos = factura.montoRecibidoCentavos - factura.totalCentavos;
  }

  let tarjeta = null;
  if (factura.formaPago === 'tarjeta') {
    tarjeta = {
      tipo: factura.tarjetaTipo,
      marca: factura.tarjetaMarca,
      ultimos4: factura.tarjetaUltimos4,
    };
  }

  return {
    id: factura.id,
    numero: formatearNumero(factura.puntoVenta, factura.numero),
    fecha: factura.fecha,
    estado: factura.estado,
    // Solo tienen valor si está anulada; si no, vienen null
    motivoAnulacion: factura.motivoAnulacion,
    anuladaEn: factura.anuladaEn,
    formaPago: factura.formaPago,
    totalCentavos: factura.totalCentavos,
    montoRecibidoCentavos: factura.montoRecibidoCentavos,
    vueltoCentavos,
    tarjeta,
    clienteNombre: fila.cliente ? fila.cliente.nombre : 'Consumidor final',
    cliente: fila.cliente,
    usuario: fila.vendedor,
    items: items.map((item) => ({
      productoId: item.productoId,
      descripcion: item.descripcion,
      cantidad: item.cantidad,
      precioUnitarioCentavos: item.precioUnitarioCentavos,
      subtotalCentavos: item.subtotalCentavos,
    })),
  };
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

    const numeroFormateado = formatearNumero(factura.puntoVenta, factura.numero);

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
  // el detalle (con estado 'anulada', motivo y fecha). Se lee después
  // del commit, así trae los datos ya confirmados.
  return await obtenerFactura(usuario, id);
}
