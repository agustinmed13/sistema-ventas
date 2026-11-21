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

import { eq, and, gte, inArray, max, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import {
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
      // ─────────────────────────────────────────────────────
      return {
        id: factura.id,
        numero: numeroFormateado,
        fecha: factura.fecha,
        estado: factura.estado,
        formaPago: factura.formaPago,
        totalCentavos: factura.totalCentavos,
        montoRecibidoCentavos: factura.montoRecibidoCentavos,
        // Vuelto solo en contado
        vueltoCentavos: montoRecibidoCentavos !== null ? montoRecibidoCentavos - totalCentavos : null,
        tarjeta: tarjeta,
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
