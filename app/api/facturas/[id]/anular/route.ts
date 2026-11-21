// POST /api/facturas/[id]/anular — anular una factura (RF-V9)
//
// Recibe: { "motivo": "Error de carga" }
//
// Regla 5: una factura confirmada no se modifica, solo se anula, y la
// anulación revierte el stock y el saldo.
// Regla 12: bajas lógicas. La factura NUNCA se borra: queda visible con
// estado 'anulada', su motivo, cuándo y quién la anuló.

import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { facturas, facturaItems, productos, movimientosStock, movimientosCuenta } from '@/db/schema';
import { obtenerUsuarioActual } from '@/lib/auth';
import {
  errorSolicitudInvalida,
  errorNoAutorizado,
  errorProhibido,
  errorNoEncontrado,
  errorConflicto,
  errorValidacion,
  errorInterno,
} from '@/lib/errores';
// El GET del detalle: lo reusamos al final para devolver la factura
// con exactamente la misma forma (ver paso 8).
import { GET as obtenerDetalle } from '../route';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // ═════════════════════════════════════════════════════════
    // PASO 1 — Sesión Y rol
    // Solo el administrador anula. Un vendedor que llame a esta ruta
    // directamente (con curl, sin pasar por la pantalla) recibe 403.
    // Ocultar el botón en la interfaz no es seguridad: el control
    // real es este if, en el servidor.
    // ═════════════════════════════════════════════════════════
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return errorNoAutorizado();
    if (usuario.rol !== 'admin') return errorProhibido('Solo un administrador puede anular facturas.');

    // El id de la URL. Si no es un entero positivo, no puede existir: 404.
    const { id } = await params;
    const facturaId = Number(id);
    if (!Number.isInteger(facturaId) || facturaId <= 0) {
      return errorNoEncontrado('La factura no existe.', { id });
    }

    // ═════════════════════════════════════════════════════════
    // PASO 2 — El motivo es obligatorio
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
    // Igual que en el POST de facturas: solo se acepta el campo esperado
    for (const campo of Object.keys(cuerpo)) {
      if (campo !== 'motivo') {
        return errorValidacion(`El campo "${campo}" no se puede enviar.`, { campo });
      }
    }
    if (typeof cuerpo.motivo !== 'string' || cuerpo.motivo.trim() === '') {
      return errorValidacion('El motivo de anulación es obligatorio.', { campo: 'motivo' });
    }
    const motivo = cuerpo.motivo.trim();

    // ═════════════════════════════════════════════════════════
    // TRANSACCIÓN — pasos 3 a 7
    // Marcar la factura, devolver el stock y acreditar la cuenta pasan
    // todos juntos o no pasa ninguno. Nunca puede quedar una factura
    // anulada con el stock sin devolver, ni al revés.
    // Adentro se usa tx, nunca db. Para cortar: throw (como en el POST).
    // ═════════════════════════════════════════════════════════
    await db.transaction(async (tx) => {
      // ─────────────────────────────────────────────────────
      // PASO 3 — Traer la factura
      // ─────────────────────────────────────────────────────
      const filas = await tx.select().from(facturas).where(eq(facturas.id, facturaId));
      const factura = filas[0];
      if (!factura) {
        throw errorNoEncontrado('La factura no existe.', { id: facturaId });
      }

      const numeroFormateado =
        String(factura.puntoVenta).padStart(4, '0') + '-' + String(factura.numero).padStart(8, '0');

      // ─────────────────────────────────────────────────────
      // PASO 4 — No anular dos veces
      // Si se pudiera, el stock se devolvería dos veces y la deuda
      // del cliente se acreditaría dos veces.
      // ─────────────────────────────────────────────────────
      if (factura.estado === 'anulada') {
        throw errorConflicto('FACTURA_YA_ANULADA', `La factura ${numeroFormateado} ya está anulada.`, {
          id: factura.id,
          anuladaEn: factura.anuladaEn,
        });
      }

      // ─────────────────────────────────────────────────────
      // PASO 5 — Marcar la factura como anulada (no se borra, regla 12)
      //
      // Es un UPDATE CONDICIONAL, con la misma idea que el descuento de
      // stock en el POST:
      //
      //   UPDATE facturas SET estado = 'anulada', ...
      //   WHERE id = 52 AND estado = 'emitida'
      //
      // El paso 4 ya verificó el estado, pero entre esa lectura y este
      // UPDATE podría colarse otra anulación de la misma factura. Con
      // "AND estado = 'emitida'" en el WHERE, solo la primera la
      // encuentra; la segunda modifica CERO filas y se corta acá, antes
      // de devolver stock.
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
        throw errorConflicto('FACTURA_YA_ANULADA', `La factura ${numeroFormateado} ya está anulada.`, {
          id: factura.id,
        });
      }

      // ─────────────────────────────────────────────────────
      // PASO 6 — Devolver el stock, renglón por renglón (regla 5)
      // ─────────────────────────────────────────────────────
      const items = await tx.select().from(facturaItems).where(eq(facturaItems.facturaId, factura.id));

      for (const item of items) {
        // Sumamos la cantidad que se había vendido:
        //   UPDATE productos SET existencia = existencia + 2 WHERE id = 3
        // Acá NO hace falta la condición "existencia >= cantidad" del POST:
        // sumar nunca deja el stock negativo, así que no hay nada que
        // pueda salir mal si dos operaciones se cruzan.
        // Se devuelve aunque el producto esté dado de baja: las unidades
        // vuelven físicamente al depósito igual.
        // .returning() nos da la existencia que quedó, para el movimiento.
        const actualizados = await tx
          .update(productos)
          .set({ existencia: sql`${productos.existencia} + ${item.cantidad}` })
          .where(eq(productos.id, item.productoId))
          .returning({ existencia: productos.existencia });

        // No debería pasar nunca (el producto no se puede borrar), pero si
        // pasa, cortamos: mejor un 500 que una anulación a medias.
        if (actualizados.length === 0) {
          throw new Error(`No se encontró el producto ${item.productoId} al anular.`);
        }

        // Movimiento de stock (regla 2): cantidad POSITIVA porque entran
        // unidades. Así la suma de movimientos sigue dando la existencia:
        // la venta restó 2 (-2) y la anulación las suma (+2).
        await tx.insert(movimientosStock).values({
          productoId: item.productoId,
          tipo: 'anulacion',
          cantidad: item.cantidad,
          existenciaResultante: actualizados[0].existencia,
          motivo: `Anulación de ${numeroFormateado}`,
          fecha,
          usuarioId: usuario.id,
          facturaId: factura.id,
        });
      }

      // ─────────────────────────────────────────────────────
      // PASO 7 — Revertir la deuda (regla 5)
      // La venta a cuenta había generado un DÉBITO por el total.
      // La anulación genera un CRÉDITO por el mismo total, y como
      // saldo = débitos − créditos, se cancelan.
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

    // ═════════════════════════════════════════════════════════
    // PASO 8 — Devolver la factura anulada
    // Llamamos a la misma función que atiende GET /api/facturas/[id].
    // Así la respuesta tiene EXACTAMENTE la misma forma que el detalle
    // (con estado 'anulada', motivo y fecha), sin copiar ese código acá.
    // Devuelve 200.
    // ═════════════════════════════════════════════════════════
    return obtenerDetalle(request, { params });
  } catch (error) {
    // Las respuestas de error lanzadas dentro de la transacción
    // (404, 409) se devuelven tal cual. La transacción ya se deshizo.
    if (error instanceof Response) return error;
    return errorInterno(error);
  }
}
