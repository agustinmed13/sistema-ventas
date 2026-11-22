// Servicio del TABLERO — RF-T1, RF-T2, RF-T3
//
// Capa de servicios (AGENTS.md sección 3): arma TODO lo que muestra la
// pantalla de inicio en una sola respuesta (consigna, sección 11.7):
//
// {
//   hoy:               { cantidad, importe }                    RF-T1
//   mes:               { cantidad, importe, ticketPromedio }    RF-T1
//   cuentasCorrientes: { totalAdeudado, clientesConSaldo }      RF-T1
//   bajoMinimo:        { cantidad }                             RF-T1
//   ventasDiarias:     [ { fecha, importe }, ... ]  30 días     RF-T2
//   porFormaDePago:    [ { forma, importe }, ... ]  del mes     RF-T2
//   masVendidos:       [ { productoId, codigo, descripcion,
//                          unidades, importe }, ... ]  5 del mes RF-T3
// }
//
// Reglas de la sección 11.7:
//   - Solo cuentan las facturas EMITIDAS (las anuladas no son ventas).
//   - "Hoy" y "el mes" se calculan en HORA DE ARGENTINA.
//   - ventasDiarias trae siempre 30 elementos, del más viejo a hoy, con 0
//     en los días sin ventas.
//   - Todos los importes en centavos enteros (regla 10).
//
// Para no repetir reglas que ya viven en otro servicio:
//   - el saldo de los clientes sale de listarClientes() (regla 7)
//   - "bajo mínimo" sale de listarProductos() de Jazmín (RF-P1)

import { eq, and, gte, desc, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { facturas, facturaItems, productos } from '@/db/schema';
import { listarClientes } from '@/lib/servicios/clientes';
import { listarProductos } from '@/lib/servicios/productos';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual)
type UsuarioSesion = { id: number; nombre: string; rol: 'admin' | 'vendedor' };

const UN_DIA_MS = 24 * 60 * 60 * 1000;
const TRES_HORAS_MS = 3 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// ¿Qué día es en Argentina? (sección 11.1: los días son de Argentina)
//
// Las fechas se guardan en UTC (hora de Londres). Argentina está 3 horas
// atrás (UTC−3). Para saber qué día es allá, le restamos 3 horas al
// instante y nos quedamos con la parte de la fecha:
//   "2026-11-22T01:07:00Z" (UTC) − 3 h → "2026-11-21T22:07" → "2026-11-21"
// Así una venta del 21 a las 22:07 en Tucumán cuenta como del 21, no del 22.
// ─────────────────────────────────────────────────────────────
function diaEnArgentina(fecha: Date): string {
  const enArgentina = new Date(fecha.getTime() - TRES_HORAS_MS);
  return enArgentina.toISOString().slice(0, 10); // "AAAA-MM-DD"
}

// El instante UTC en que EMPIEZA un día de Argentina.
//   "2026-11-21" → 2026-11-21 00:00 en Argentina → "2026-11-21T03:00:00.000Z"
function inicioDelDia(dia: string): string {
  return new Date(dia + 'T00:00:00-03:00').toISOString();
}

// ═════════════════════════════════════════════════════════════
// obtenerTablero — RF-T1, RF-T2, RF-T3
// Los dos roles ven el tablero: no hay chequeo de rol.
// ═════════════════════════════════════════════════════════════
export async function obtenerTablero(usuario: UsuarioSesion) {
  // ═══ 1. VALIDAR ═══ no recibe datos: no hay nada que validar.
  // ═══ 2. PERMISO ═══ admin y vendedor pueden ver el tablero.

  // ═══ 3. REGLAS ═══

  // --- Los días que importan, en hora de Argentina ---
  const ahora = new Date();
  const hoy = diaEnArgentina(ahora); // "2026-11-22"
  const primeroDelMes = hoy.slice(0, 7) + '-01'; // "2026-11-01"

  // Los 30 días del gráfico: desde hace 29 días hasta hoy (30 en total).
  // Se arma la lista entera de antemano, así los días sin ventas quedan
  // con importe 0 (sección 11.7).
  const ultimos30Dias: string[] = [];
  for (let i = 29; i >= 0; i--) {
    ultimos30Dias.push(diaEnArgentina(new Date(ahora.getTime() - i * UN_DIA_MS)));
  }

  // Hay que traer las facturas desde el día más viejo que se necesita:
  // el primero de los 30 días o el primero del mes, el que sea anterior.
  // Las fechas "AAAA-MM-DD" se pueden comparar como texto.
  let diaMasViejo = ultimos30Dias[0];
  if (primeroDelMes < diaMasViejo) diaMasViejo = primeroDelMes;

  // --- Las facturas EMITIDAS desde ese día ---
  // Solo las columnas que hacen falta. Las anuladas no son ventas (11.7).
  const facturasDelPeriodo = await db
    .select({
      fecha: facturas.fecha,
      total: facturas.totalCentavos,
      forma: facturas.formaPago,
    })
    .from(facturas)
    .where(and(eq(facturas.estado, 'emitida'), gte(facturas.fecha, inicioDelDia(diaMasViejo))));

  // --- Recorrer las facturas una vez y repartirlas en los totales ---
  const totalHoy = { cantidad: 0, importe: 0 };
  const totalMes = { cantidad: 0, importe: 0 };

  // Importe por forma de pago del mes (RF-T2). Arrancan en 0 las tres.
  const importePorForma = { contado: 0, tarjeta: 0, cuenta_corriente: 0 };

  // Importe por día de los últimos 30 (RF-T2).
  // Un objeto { "2026-11-21": 0, "2026-11-22": 0, ... } con los 30 días.
  const importePorDia: { [dia: string]: number } = {};
  for (const dia of ultimos30Dias) importePorDia[dia] = 0;

  for (const factura of facturasDelPeriodo) {
    const dia = diaEnArgentina(new Date(factura.fecha));

    // Ventas de hoy (RF-T1)
    if (dia === hoy) {
      totalHoy.cantidad = totalHoy.cantidad + 1;
      totalHoy.importe = totalHoy.importe + factura.total;
    }

    // Ventas del mes en curso (RF-T1) y por forma de pago (RF-T2)
    if (dia >= primeroDelMes) {
      totalMes.cantidad = totalMes.cantidad + 1;
      totalMes.importe = totalMes.importe + factura.total;
      importePorForma[factura.forma] = importePorForma[factura.forma] + factura.total;
    }

    // Ventas por día (RF-T2). Si el día no está entre los 30, se ignora.
    if (importePorDia[dia] !== undefined) {
      importePorDia[dia] = importePorDia[dia] + factura.total;
    }
  }

  // Ticket promedio = importe del mes ÷ cantidad de ventas del mes.
  // Math.round: los importes son centavos ENTEROS (regla 10).
  // Sin ventas, 0 (no se puede dividir por cero).
  let ticketPromedio = 0;
  if (totalMes.cantidad > 0) {
    ticketPromedio = Math.round(totalMes.importe / totalMes.cantidad);
  }

  // --- Los 5 más vendidos del mes, por unidades (RF-T3) ---
  // Se suman los renglones de las facturas emitidas del mes, agrupados por
  // producto (GROUP BY), y se ordenan de más a menos unidades.
  // El importe es la suma de los subtotales: el precio CONGELADO de cada
  // venta (regla 3), no el precio de hoy del catálogo.
  const masVendidos = await db
    .select({
      productoId: productos.id,
      codigo: productos.codigo,
      descripcion: productos.descripcion,
      unidades: sql<number>`sum(${facturaItems.cantidad})`,
      importe: sql<number>`sum(${facturaItems.subtotalCentavos})`,
    })
    .from(facturaItems)
    .innerJoin(facturas, eq(facturaItems.facturaId, facturas.id))
    .innerJoin(productos, eq(facturaItems.productoId, productos.id))
    .where(and(eq(facturas.estado, 'emitida'), gte(facturas.fecha, inicioDelDia(primeroDelMes))))
    .groupBy(productos.id, productos.codigo, productos.descripcion)
    .orderBy(desc(sql`sum(${facturaItems.cantidad})`))
    .limit(5);

  // --- Cuentas corrientes (RF-T1) ---
  // listarClientes con conDeuda=true ya calcula el saldo de cada cliente
  // (regla 7) y devuelve totalAdeudado. Su "total" es cuántos deben.
  // pageSize 1: no necesitamos la lista, solo los totales.
  const deudores = await listarClientes(usuario, {
    q: null,
    conDeuda: 'true',
    orden: null,
    page: null,
    pageSize: '1',
  });

  // --- Productos bajo el mínimo (RF-T1) ---
  // Mismo criterio que el catálogo: lo decide listarProductos de Jazmín.
  // Su "total" es cuántos productos activos están bajo el mínimo.
  const bajoMinimo = await listarProductos(usuario, {
    q: null,
    categoriaId: null,
    bajoMinimo: 'true',
    activo: null,
    page: null,
    pageSize: '1',
  });

  // ═══ 4. DEVOLVER ═══ (nombres de la sección 11.7)
  return {
    hoy: totalHoy,
    mes: { cantidad: totalMes.cantidad, importe: totalMes.importe, ticketPromedio },
    cuentasCorrientes: {
      totalAdeudado: deudores.totalAdeudado ?? 0,
      clientesConSaldo: deudores.total,
    },
    bajoMinimo: { cantidad: bajoMinimo.total },
    // Los 30 días en orden, del más viejo a hoy
    ventasDiarias: ultimos30Dias.map((dia) => ({ fecha: dia, importe: importePorDia[dia] })),
    porFormaDePago: [
      { forma: 'contado', importe: importePorForma.contado },
      { forma: 'tarjeta', importe: importePorForma.tarjeta },
      { forma: 'cuenta_corriente', importe: importePorForma.cuenta_corriente },
    ],
    // Number(): la base puede devolver las sumas como texto
    masVendidos: masVendidos.map((p) => ({
      productoId: p.productoId,
      codigo: p.codigo,
      descripcion: p.descripcion,
      unidades: Number(p.unidades),
      importe: Number(p.importe),
    })),
  };
}
