// POST /api/facturas — emitir una factura (RF-V)
//
// Recibe:
// {
//   "clienteId": 3,                     // null = consumidor final
//   "formaPago": "cuenta_corriente",    // contado | tarjeta | cuenta_corriente
//   "items": [ { "productoId": 1, "cantidad": 2 } ],
//   "montoRecibidoCentavos": 2000000,   // solo si es contado
//   "tarjeta": { "tipo": "credito", "marca": "Visa", "ultimos4": "1234" }
// }
//
// El cliente NUNCA manda precios, subtotales, total, número ni fecha:
// todo eso lo calcula el servidor. Si el cliente pudiera mandar el total,
// cualquiera compraría por un peso editando el pedido.

import { eq, and, gte, lt, inArray, max, desc, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/index';
import {
  usuarios,
  clientes,
  productos,
  facturas,
  facturaItems,
  movimientosStock,
  movimientosCuenta,
} from '@/db/schema';
import { obtenerUsuarioActual } from '@/lib/auth';
import {
  errorSolicitudInvalida,
  errorNoAutorizado,
  errorNoEncontrado,
  errorConflicto,
  errorValidacion,
  errorInterno,
} from '@/lib/errores';

// Por ahora hay un solo punto de venta
const PUNTO_VENTA = 1;

// Los únicos campos que el cliente puede mandar. Cualquier otro (total,
// precio, numero, fecha...) se rechaza con 422.
const CAMPOS_PERMITIDOS = ['clienteId', 'formaPago', 'items', 'montoRecibidoCentavos', 'tarjeta'];
const CAMPOS_PERMITIDOS_ITEM = ['productoId', 'cantidad'];
const CAMPOS_PERMITIDOS_TARJETA = ['tipo', 'marca', 'ultimos4'];

export async function POST(request: Request) {
  try {
    // ═════════════════════════════════════════════════════════
    // PASO 1 — Verificar la sesión
    // Pueden facturar admin y vendedor, así que alcanza con que haya sesión.
    // ═════════════════════════════════════════════════════════
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return errorNoAutorizado();

    // ═════════════════════════════════════════════════════════
    // PASO 2 — Validar la estructura del pedido
    // Esto no necesita la base: solo mira que los datos tengan la forma
    // correcta. Si algo está mal, cortamos antes de abrir la transacción.
    // ═════════════════════════════════════════════════════════
    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      return errorSolicitudInvalida('El cuerpo no es JSON válido.');
    }
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      return errorSolicitudInvalida('Se esperaba un objeto JSON.');
    }

    // Campos que no corresponden (total, precios, número, fecha...): 422
    for (const campo of Object.keys(cuerpo)) {
      if (!CAMPOS_PERMITIDOS.includes(campo)) {
        return errorValidacion(`El campo "${campo}" no se puede enviar.`, { campo });
      }
    }

    // --- items ---
    if (!Array.isArray(cuerpo.items) || cuerpo.items.length === 0) {
      return errorValidacion('La factura tiene que tener al menos un ítem.', { campo: 'items' });
    }

    // Armamos "renglones": la lista de ítems con los productos repetidos
    // ya sumados (RF-V3: agregar un producto que ya está suma la cantidad).
    const renglones: { productoId: number; cantidad: number }[] = [];

    for (const item of cuerpo.items) {
      if (typeof item !== 'object' || item === null) {
        return errorValidacion('Cada ítem tiene que ser un objeto.', { campo: 'items' });
      }
      for (const campo of Object.keys(item)) {
        if (!CAMPOS_PERMITIDOS_ITEM.includes(campo)) {
          return errorValidacion(`El campo "${campo}" no se puede enviar en un ítem.`, { campo });
        }
      }
      // Number.isInteger rechaza decimales, textos y null de una vez
      if (!Number.isInteger(item.productoId) || item.productoId <= 0) {
        return errorValidacion('Cada ítem necesita un productoId válido.', { campo: 'productoId' });
      }
      if (!Number.isInteger(item.cantidad) || item.cantidad <= 0) {
        return errorValidacion('La cantidad tiene que ser un entero positivo.', {
          campo: 'cantidad',
          productoId: item.productoId,
        });
      }

      const yaEsta = renglones.find((r) => r.productoId === item.productoId);
      if (yaEsta) {
        yaEsta.cantidad = yaEsta.cantidad + item.cantidad;
      } else {
        renglones.push({ productoId: item.productoId, cantidad: item.cantidad });
      }
    }

    // --- formaPago ---
    const formaPago = cuerpo.formaPago;
    if (formaPago !== 'contado' && formaPago !== 'tarjeta' && formaPago !== 'cuenta_corriente') {
      return errorValidacion('La forma de pago tiene que ser contado, tarjeta o cuenta_corriente.', {
        campo: 'formaPago',
      });
    }

    // --- clienteId --- (null o ausente = consumidor final)
    let clienteId: number | null = null;
    if (cuerpo.clienteId !== undefined && cuerpo.clienteId !== null) {
      if (!Number.isInteger(cuerpo.clienteId) || cuerpo.clienteId <= 0) {
        return errorValidacion('El clienteId no es válido.', { campo: 'clienteId' });
      }
      clienteId = cuerpo.clienteId;
    }

    // --- contado: monto recibido ---
    // Acá solo verificamos que sea un entero positivo. Que alcance para
    // pagar el total se verifica en el paso 5, cuando ya tenemos los precios.
    let montoRecibidoCentavos: number | null = null;
    if (formaPago === 'contado') {
      if (!Number.isInteger(cuerpo.montoRecibidoCentavos) || cuerpo.montoRecibidoCentavos <= 0) {
        return errorValidacion('En contado hay que indicar el monto recibido (entero positivo).', {
          campo: 'montoRecibidoCentavos',
        });
      }
      montoRecibidoCentavos = cuerpo.montoRecibidoCentavos;
    }

    // --- tarjeta ---
    // Regla 9: de la tarjeta solo se guardan tipo, marca y últimos 4 dígitos.
    // Como solo aceptamos esos tres campos, el número completo no puede entrar.
    let tarjeta: { tipo: 'debito' | 'credito'; marca: string; ultimos4: string } | null = null;
    if (formaPago === 'tarjeta') {
      const t = cuerpo.tarjeta;
      if (typeof t !== 'object' || t === null) {
        return errorValidacion('En pago con tarjeta hay que indicar los datos de la tarjeta.', {
          campo: 'tarjeta',
        });
      }
      for (const campo of Object.keys(t)) {
        if (!CAMPOS_PERMITIDOS_TARJETA.includes(campo)) {
          return errorValidacion(`El campo "${campo}" no se puede enviar en la tarjeta.`, { campo });
        }
      }
      if (t.tipo !== 'debito' && t.tipo !== 'credito') {
        return errorValidacion('El tipo de tarjeta tiene que ser debito o credito.', { campo: 'tarjeta.tipo' });
      }
      if (typeof t.marca !== 'string' || t.marca.trim() === '') {
        return errorValidacion('La marca de la tarjeta es obligatoria.', { campo: 'tarjeta.marca' });
      }
      // /^\d{4}$/ = exactamente 4 dígitos, ni más ni menos
      if (typeof t.ultimos4 !== 'string' || !/^\d{4}$/.test(t.ultimos4)) {
        return errorValidacion('Los últimos 4 dígitos tienen que ser exactamente 4 números.', {
          campo: 'tarjeta.ultimos4',
        });
      }
      tarjeta = { tipo: t.tipo, marca: t.marca.trim(), ultimos4: t.ultimos4 };
    }

    // --- cuenta corriente ---
    // Regla 6: consumidor final no compra en cuenta corriente.
    if (formaPago === 'cuenta_corriente' && clienteId === null) {
      return errorValidacion('Consumidor final no puede comprar en cuenta corriente.', {
        campo: 'clienteId',
      });
    }

    // ═════════════════════════════════════════════════════════
    // TRANSACCIÓN — pasos 3 a 12
    //
    // Todo lo que sigue pasa entero o no pasa nada. Si en cualquier
    // punto hay un error (sin stock, límite superado, se cae la conexión),
    // la base vuelve a como estaba antes: no queda una factura sin
    // ítems, ni stock descontado sin factura, ni una deuda sin venta.
    //
    // Adentro se usa SIEMPRE "tx" y nunca "db": tx es la conexión que
    // está dentro de la transacción. Si usáramos db, esa consulta quedaría
    // afuera y no se desharía.
    //
    // Para cortar la transacción LANZAMOS (throw) la respuesta de error.
    // Drizzle ve el throw, deshace todo (rollback) y lo vuelve a lanzar;
    // el catch del final lo recibe y lo devuelve al cliente.
    // ═════════════════════════════════════════════════════════
    const respuesta = await db.transaction(async (tx) => {
      // ─────────────────────────────────────────────────────
      // PASO 3 — El cliente (si hay)
      // ─────────────────────────────────────────────────────
      let cliente = null;
      if (clienteId !== null) {
        const filas = await tx.select().from(clientes).where(eq(clientes.id, clienteId));
        cliente = filas[0];

        if (!cliente) {
          throw errorNoEncontrado('El cliente no existe.', { clienteId });
        }
        if (!cliente.activo) {
          throw errorValidacion('El cliente está inactivo.', { clienteId });
        }
        // Regla 6: solo un cliente habilitado compra en cuenta corriente
        if (formaPago === 'cuenta_corriente' && !cliente.cuentaCorrienteHabilitada) {
          throw errorValidacion('El cliente no tiene cuenta corriente habilitada.', { clienteId });
        }
      }

      // ─────────────────────────────────────────────────────
      // PASO 4 — Los productos, todos en una sola consulta
      // inArray = "WHERE id IN (1, 5, 7)"
      // ─────────────────────────────────────────────────────
      const ids = renglones.map((r) => r.productoId);
      const productosEncontrados = await tx.select().from(productos).where(inArray(productos.id, ids));

      for (const renglon of renglones) {
        const producto = productosEncontrados.find((p) => p.id === renglon.productoId);
        if (!producto) {
          throw errorNoEncontrado('El producto no existe.', { productoId: renglon.productoId });
        }
        // RF-P3: un producto dado de baja no se vende
        if (!producto.activo) {
          throw errorValidacion(`El producto ${producto.descripcion} está dado de baja.`, {
            productoId: producto.id,
          });
        }
      }

      // ─────────────────────────────────────────────────────
      // PASO 5 — Calcular importes con los precios DE LA BASE
      // ─────────────────────────────────────────────────────
      let totalCentavos = 0;
      const detalle = renglones.map((renglon) => {
        // El "!" le dice a TypeScript "esto no es undefined". Es seguro:
        // en el paso 4 ya verificamos que cada producto existe.
        const producto = productosEncontrados.find((p) => p.id === renglon.productoId)!;
        const subtotalCentavos = producto.precioCentavos * renglon.cantidad;
        totalCentavos = totalCentavos + subtotalCentavos;
        return { producto, cantidad: renglon.cantidad, subtotalCentavos };
      });

      // Contado: lo recibido tiene que alcanzar para pagar
      if (montoRecibidoCentavos !== null && montoRecibidoCentavos < totalCentavos) {
        throw errorValidacion('El monto recibido no alcanza para pagar el total.', {
          campo: 'montoRecibidoCentavos',
          totalCentavos,
          montoRecibidoCentavos,
        });
      }

      // ─────────────────────────────────────────────────────
      // PASO 6 — Límite de crédito (regla 7)
      // Saldo = débitos − créditos. Si el cliente tiene límite,
      // saldo actual + esta venta no puede superarlo.
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
          throw errorConflicto('LIMITE_CREDITO_SUPERADO', 'La venta supera el límite de crédito del cliente.', {
            clienteId: cliente.id,
            limiteCentavos: cliente.limiteCreditoCentavos,
            saldoActualCentavos: saldoCentavos,
            totalVentaCentavos: totalCentavos,
          });
        }
      }

      // ─────────────────────────────────────────────────────
      // PASO 7 — Asignar el número (regla 4)
      // El más alto que existe + 1. Se asigna recién ahora, al confirmar:
      // si la venta falla, la transacción se deshace y el número no se
      // "gasta", así no quedan huecos.
      // ─────────────────────────────────────────────────────
      const [ultima] = await tx
        .select({ maximo: max(facturas.numero) })
        .from(facturas)
        .where(eq(facturas.puntoVenta, PUNTO_VENTA));
      const numero = (ultima.maximo ?? 0) + 1; // ?? 0: si no hay facturas, max da null

      // Formato 0001-00000042: padStart rellena con ceros a la izquierda
      const numeroFormateado = String(PUNTO_VENTA).padStart(4, '0') + '-' + String(numero).padStart(8, '0');
      const fecha = new Date().toISOString(); // la fecha la pone el servidor

      // ─────────────────────────────────────────────────────
      // PASO 8 — Insertar la factura
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

      // Pasos 9, 10 y 11, renglón por renglón
      for (const renglon of detalle) {
        const producto = renglon.producto;

        // ───────────────────────────────────────────────────
        // PASO 9 — El renglón de la factura (regla 3)
        // Se COPIAN la descripción y el precio de hoy. Si mañana cambia
        // el precio del catálogo, esta factura sigue mostrando el de hoy.
        // ───────────────────────────────────────────────────
        await tx.insert(facturaItems).values({
          facturaId: factura.id,
          productoId: producto.id,
          descripcion: producto.descripcion,
          cantidad: renglon.cantidad,
          precioUnitarioCentavos: producto.precioCentavos,
          subtotalCentavos: renglon.subtotalCentavos,
        });

        // ───────────────────────────────────────────────────
        // PASO 10 — Descontar el stock (regla 1: nunca negativo)
        //
        // Es un UPDATE CONDICIONAL. En SQL es:
        //
        //   UPDATE productos
        //   SET existencia = existencia - 2
        //   WHERE id = 1 AND existencia >= 2
        //
        // La comprobación ("¿alcanza?") y la resta ocurren en la MISMA
        // operación. Si no alcanza, el WHERE no encuentra la fila y no se
        // modifica nada.
        //
        // Por qué NO leer primero y restar después:
        //   Queda 1 unidad. Dos vendedores la venden al mismo tiempo.
        //     Vendedor A lee: hay 1, alcanza.
        //     Vendedor B lee: hay 1, alcanza.
        //     A resta: queda 0.   B resta: queda -1.  ← stock negativo
        //   Entre la lectura y la resta pasa tiempo, y en ese hueco otro
        //   pedido puede cambiar el dato. Con el UPDATE condicional no hay
        //   hueco: el segundo UPDATE ya ve existencia = 0, 0 >= 1 es falso,
        //   y no modifica nada.
        //
        // sql`...` permite escribir "existencia - 2" usando el valor que
        // está en la base en ese momento, no uno leído antes.
        // .returning() devuelve las filas que se modificaron: si la lista
        // está vacía, se modificaron CERO filas, o sea, no había stock.
        // ───────────────────────────────────────────────────
        const actualizados = await tx
          .update(productos)
          .set({ existencia: sql`${productos.existencia} - ${renglon.cantidad}` })
          .where(and(eq(productos.id, producto.id), gte(productos.existencia, renglon.cantidad)))
          .returning({ existencia: productos.existencia });

        if (actualizados.length === 0) {
          // throw: se deshace TODO, incluida la factura y los renglones
          // que ya se habían insertado.
          throw errorConflicto('STOCK_INSUFICIENTE', `No hay stock suficiente para ${producto.descripcion}.`, {
            productoId: producto.id,
            disponible: producto.existencia,
            solicitado: renglon.cantidad,
          });
        }

        // ───────────────────────────────────────────────────
        // PASO 11 — Movimiento de stock (regla 2)
        // Cantidad NEGATIVA: es una salida. Así la suma de todos los
        // movimientos de un producto da su existencia actual.
        // ───────────────────────────────────────────────────
        await tx.insert(movimientosStock).values({
          productoId: producto.id,
          tipo: 'venta',
          cantidad: -renglon.cantidad,
          existenciaResultante: actualizados[0].existencia, // la que devolvió el UPDATE
          motivo: `Venta ${numeroFormateado}`,
          fecha,
          usuarioId: usuario.id,
          facturaId: factura.id,
        });
      }

      // ─────────────────────────────────────────────────────
      // PASO 12 — Deuda en cuenta corriente
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
      // PASO 13 — Armar la respuesta
      // Lo que devuelve esta función es lo que queda en "respuesta".
      // Si llegamos acá sin ningún throw, Drizzle confirma (commit).
      // Es la MISMA forma que devuelve GET /api/facturas/[id], así la
      // pantalla usa una sola estructura para el comprobante.
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

    // 201 = "se creó algo nuevo"
    return Response.json(respuesta, { status: 201 });
  } catch (error) {
    // Si lo que se lanzó es una respuesta de error nuestra (los throw de
    // adentro de la transacción), la devolvemos tal cual. La transacción
    // ya se deshizo.
    if (error instanceof Response) return error;

    // Cualquier otra cosa es un error inesperado: 500 sin detalles.
    return errorInterno(error);
  }
}

// ═════════════════════════════════════════════════════════════
// GET /api/facturas — listado de facturas (RF-V8)
//
// Filtros opcionales y combinables, en la URL:
//   /api/facturas?formaPago=contado&desde=2026-11-01&hasta=2026-11-21
//
//   desde, hasta   fechas YYYY-MM-DD (días de Argentina, ambos incluidos)
//   clienteId      número
//   formaPago      contado | tarjeta | cuenta_corriente
//   usuarioId      número (el vendedor que la emitió)
//   numero         "42" o "0001-00000042"
//   estado         emitida | anulada
//
// PENDIENTE: paginado. La consigna lo pide, pero por ahora devuelve
// todas las facturas que cumplen los filtros. Documentado en el README.
// ═════════════════════════════════════════════════════════════
export async function GET(request: Request) {
  try {
    // Los dos roles pueden consultar: alcanza con que haya sesión
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return errorNoAutorizado();

    // searchParams = lo que viene después del "?" en la URL.
    // "|| null" hace que un parámetro vacío (?formaPago=) cuente como
    // si no hubiera venido.
    const parametros = new URL(request.url).searchParams;
    const desde = parametros.get('desde') || null;
    const hasta = parametros.get('hasta') || null;
    const clienteId = parametros.get('clienteId') || null;
    const formaPago = parametros.get('formaPago') || null;
    const usuarioId = parametros.get('usuarioId') || null;
    const numero = parametros.get('numero') || null;
    const estado = parametros.get('estado') || null;

    // Vamos juntando una condición por cada filtro que vino.
    // Al final se combinan todas con AND. Si no vino ninguno, la lista
    // queda vacía y se devuelven todas las facturas.
    const condiciones: SQL[] = [];

    // --- Fechas ---
    // Las fechas se guardan en UTC (hora de Londres), pero el usuario
    // piensa en días de Argentina (UTC−3). Una venta del 21/11 a las
    // 22:00 en Tucumán se guarda como "2026-11-22T01:00:00Z".
    // Por eso convertimos el día pedido a su comienzo en hora argentina:
    //   desde=2026-11-21 → desde las 00:00 del 21 en Argentina
    //   hasta=2026-11-21 → hasta ANTES de las 00:00 del 22 en Argentina
    // Así "hasta" incluye el día completo.
    const UN_DIA_MS = 24 * 60 * 60 * 1000;
    const FORMATO_FECHA = /^\d{4}-\d{2}-\d{2}$/;

    if (desde !== null) {
      const inicio = new Date(desde + 'T00:00:00-03:00');
      if (!FORMATO_FECHA.test(desde) || isNaN(inicio.getTime())) {
        return errorValidacion('La fecha "desde" tiene que tener el formato AAAA-MM-DD.', { campo: 'desde' });
      }
      // Las fechas ISO se pueden comparar como texto: "2026-11-21..." < "2026-11-22..."
      condiciones.push(gte(facturas.fecha, inicio.toISOString()));
    }

    if (hasta !== null) {
      const inicioDelDia = new Date(hasta + 'T00:00:00-03:00');
      if (!FORMATO_FECHA.test(hasta) || isNaN(inicioDelDia.getTime())) {
        return errorValidacion('La fecha "hasta" tiene que tener el formato AAAA-MM-DD.', { campo: 'hasta' });
      }
      const inicioDelDiaSiguiente = new Date(inicioDelDia.getTime() + UN_DIA_MS);
      condiciones.push(lt(facturas.fecha, inicioDelDiaSiguiente.toISOString()));
    }

    // --- clienteId ---
    if (clienteId !== null) {
      const id = Number(clienteId);
      if (!Number.isInteger(id) || id <= 0) {
        return errorValidacion('El clienteId no es válido.', { campo: 'clienteId' });
      }
      condiciones.push(eq(facturas.clienteId, id));
    }

    // --- formaPago ---
    if (formaPago !== null) {
      if (formaPago !== 'contado' && formaPago !== 'tarjeta' && formaPago !== 'cuenta_corriente') {
        return errorValidacion('La forma de pago tiene que ser contado, tarjeta o cuenta_corriente.', {
          campo: 'formaPago',
        });
      }
      condiciones.push(eq(facturas.formaPago, formaPago));
    }

    // --- usuarioId (vendedor) ---
    if (usuarioId !== null) {
      const id = Number(usuarioId);
      if (!Number.isInteger(id) || id <= 0) {
        return errorValidacion('El usuarioId no es válido.', { campo: 'usuarioId' });
      }
      condiciones.push(eq(facturas.usuarioId, id));
    }

    // --- numero ---
    // Acepta "42" o "0001-00000042". Nos quedamos con lo que está después
    // del último guion y lo pasamos a número: "00000042" → 42.
    if (numero !== null) {
      const partes = numero.trim().split('-');
      const n = Number(partes[partes.length - 1]);
      if (!Number.isInteger(n) || n <= 0) {
        return errorValidacion('El número de comprobante no es válido.', { campo: 'numero' });
      }
      condiciones.push(eq(facturas.numero, n));
    }

    // --- estado ---
    if (estado !== null) {
      if (estado !== 'emitida' && estado !== 'anulada') {
        return errorValidacion('El estado tiene que ser emitida o anulada.', { campo: 'estado' });
      }
      condiciones.push(eq(facturas.estado, estado));
    }

    // --- La consulta ---
    // JOIN = "pegar" a cada factura datos de otra tabla.
    //   leftJoin clientes: trae el nombre del cliente. Es LEFT porque el
    //     consumidor final no tiene cliente (clienteId null): sin LEFT,
    //     esas facturas desaparecerían del listado.
    //   innerJoin usuarios: trae el nombre del vendedor. Toda factura
    //     tiene vendedor. Del usuario pedimos SOLO el nombre.
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
      .orderBy(desc(facturas.fecha), desc(facturas.numero));

    const datos = filas.map((f) => ({
      id: f.id,
      numero: String(f.puntoVenta).padStart(4, '0') + '-' + String(f.numero).padStart(8, '0'),
      fecha: f.fecha,
      estado: f.estado,
      formaPago: f.formaPago,
      totalCentavos: f.totalCentavos,
      clienteNombre: f.clienteNombre ?? 'Consumidor final', // ?? = "si es null, usá esto"
      vendedorNombre: f.vendedorNombre,
    }));

    return Response.json({ datos });
  } catch (error) {
    return errorInterno(error);
  }
}
