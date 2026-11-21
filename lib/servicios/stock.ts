// Servicio de stock (RF-P6).
//
// moverStock() es el ÚNICO lugar del sistema donde cambia la existencia
// de un producto (consigna, sección 10.2). Ventas, anulaciones, ingresos
// y egresos la llaman; nadie más hace UPDATE sobre productos.existencia.
//
// Así la regla 1 (la existencia nunca es negativa) y la regla 2 (todo
// cambio de stock deja un movimiento) viven en un solo lugar: si mañana
// hay que cambiarlas, se cambian acá.

import { eq, and, gte, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { productos, movimientosStock } from '@/db/schema';
import { ApiError } from '@/lib/errores';

// El tipo de "tx", la conexión que está DENTRO de una transacción.
// Se lee de adentro hacia afuera: db.transaction recibe una función
// (Parameters<...>[0]), y esa función recibe tx (Parameters<...>[0]).
// Lo usan los servicios para pasarle la transacción a moverStock.
export type Transaccion = Parameters<Parameters<typeof db.transaction>[0]>[0];

type DatosMovimiento = {
  productoId: number;
  tipo: 'venta' | 'anulacion' | 'ingreso' | 'egreso';
  // CON SIGNO: negativa saca unidades (venta, egreso), positiva las
  // devuelve o las suma (anulación, ingreso). Nunca cero.
  cantidad: number;
  motivo: string; // ej: "Venta 0001-00000042"
  fecha: string; // la pone quien llama, para que coincida con la factura
  usuarioId: number; // regla 11: quién hizo el movimiento
  facturaId: number | null; // solo si viene de una venta o de su anulación
};

// ─────────────────────────────────────────────────────────────
// moverStock — cambia la existencia Y graba el movimiento.
//
// Recibe la transacción (tx) de quien la llama: así el cambio de stock
// queda dentro de la MISMA transacción que la factura o la anulación.
// Si algo falla después, se deshace todo junto (regla 2).
//
// Devuelve la existencia que quedó.
// ─────────────────────────────────────────────────────────────
export async function moverStock(tx: Transaccion, datos: DatosMovimiento) {
  let actualizados;

  if (datos.cantidad < 0) {
    // ─────────────────────────────────────────────────────
    // SALIDA (venta, egreso) — UPDATE CONDICIONAL (regla 1)
    //
    //   UPDATE productos
    //   SET existencia = existencia + (-2)
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
    //   y no modifica nada. Es el punto 4 de la lista de la sección 10.8:
    //   dos ventas simultáneas de la última unidad terminan con una sola
    //   factura.
    //
    // sql`...` hace la cuenta con el valor que tiene la base EN ESE
    // MOMENTO, no con uno leído antes.
    // ─────────────────────────────────────────────────────
    const cantidadAbsoluta = -datos.cantidad; // -2 → 2

    actualizados = await tx
      .update(productos)
      .set({ existencia: sql`${productos.existencia} + ${datos.cantidad}` })
      .where(and(eq(productos.id, datos.productoId), gte(productos.existencia, cantidadAbsoluta)))
      // .returning() devuelve las filas modificadas. Lista vacía =
      // CERO filas modificadas = no había stock suficiente.
      .returning({ existencia: productos.existencia });

    if (actualizados.length === 0) {
      // Leemos el producto solo para armar un mensaje claro
      const [producto] = await tx
        .select({ descripcion: productos.descripcion, existencia: productos.existencia })
        .from(productos)
        .where(eq(productos.id, datos.productoId));

      // No debería pasar: quien llama ya verificó que el producto existe
      if (!producto) {
        throw new Error(`moverStock: no existe el producto ${datos.productoId}.`);
      }

      // throw: quien llamó está en una transacción, así que se deshace
      // TODO lo que ya se había hecho (la factura, otros renglones...).
      // 409 porque choca con el estado actual de los datos (sección 11.8).
      const detalle = `Disponible: ${producto.existencia}, solicitado: ${cantidadAbsoluta}.`;
      throw new ApiError(
        409,
        'STOCK_INSUFICIENTE',
        `No hay stock suficiente para ${producto.descripcion}. ${detalle}`,
        [{ campo: 'cantidad', mensaje: detalle }]
      );
    }
  } else {
    // ─────────────────────────────────────────────────────
    // ENTRADA (anulación, ingreso) — suma sin condición
    //
    //   UPDATE productos SET existencia = existencia + 2 WHERE id = 3
    //
    // Sumar nunca deja el stock negativo, así que no hace falta
    // ninguna condición: no hay nada que pueda salir mal si dos
    // operaciones se cruzan.
    // Se suma aunque el producto esté dado de baja: las unidades
    // vuelven físicamente al depósito igual.
    // ─────────────────────────────────────────────────────
    actualizados = await tx
      .update(productos)
      .set({ existencia: sql`${productos.existencia} + ${datos.cantidad}` })
      .where(eq(productos.id, datos.productoId))
      .returning({ existencia: productos.existencia });

    // No debería pasar nunca (los productos no se borran), pero si pasa,
    // cortamos: mejor un 500 que un movimiento sin producto.
    if (actualizados.length === 0) {
      throw new Error(`moverStock: no existe el producto ${datos.productoId}.`);
    }
  }

  const existenciaResultante = actualizados[0].existencia;

  // ─────────────────────────────────────────────────────
  // El movimiento (regla 2), en la misma transacción.
  // La cantidad va CON SIGNO: así la suma de todos los movimientos de
  // un producto da su existencia actual (sección 10.8, punto 5).
  // ─────────────────────────────────────────────────────
  await tx.insert(movimientosStock).values({
    productoId: datos.productoId,
    tipo: datos.tipo,
    cantidad: datos.cantidad,
    existenciaResultante,
    motivo: datos.motivo,
    fecha: datos.fecha,
    usuarioId: datos.usuarioId,
    facturaId: datos.facturaId,
  });

  return existenciaResultante;
}
