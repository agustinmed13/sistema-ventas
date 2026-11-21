// Servicio de PAGOS — RF-C5
//
// Capa de servicios (AGENTS.md sección 3): ACÁ VIVEN LAS REGLAS DE LOS PAGOS.
// No sabe nada de HTTP: la ruta app/api/clientes/[id]/pagos solo lee el
// pedido, llama a registrarPago() y responde.
//
// Reglas que se aplican acá:
//   regla 4  → los recibos tienen numeración propia, correlativa y sin huecos
//   regla 6  → solo paga quien tiene cuenta corriente habilitada
//   regla 8  → un pago no puede superar la deuda
//   regla 11 → el pago registra quién lo cobró y cuándo
//   AGENTS.md sección 3 → pago + crédito en UNA transacción

import { eq, max } from 'drizzle-orm';
import { db } from '@/db/index';
import { clientes, pagos, movimientosCuenta } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';
import { formatearNumeroFactura } from '@/lib/formato';
import { calcularSaldoCliente } from '@/lib/servicios/clientes';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual)
type UsuarioSesion = { id: number; nombre: string; rol: 'admin' | 'vendedor' };

// Por ahora hay un solo punto de venta, igual que en facturas
const PUNTO_VENTA = 1;

// ─────────────────────────────────────────────────────────────
// Medios de pago: la API y la base los llaman distinto.
//   API (sección 5.1)   →  columna "medio" de la base
//   'efectivo'          →  'efectivo'
//   'transferencia'     →  'transferencia'
//   'tarjeta_debito'    →  'tarjeta'
// La base no se toca (pedido de Agustín): el servicio traduce.
// ─────────────────────────────────────────────────────────────
type MedioApi = 'efectivo' | 'transferencia' | 'tarjeta_debito';
type MedioBase = 'efectivo' | 'transferencia' | 'tarjeta';

function medioABase(medio: MedioApi): MedioBase {
  if (medio === 'tarjeta_debito') return 'tarjeta';
  return medio;
}

function medioAApi(medio: MedioBase): MedioApi {
  if (medio === 'tarjeta') return 'tarjeta_debito';
  return medio;
}

// ─────────────────────────────────────────────────────────────
// Número de recibo como TEXTO (sección 5.1): 341 → "R 0001-00000341"
// En la base se guarda solo el número entero (341). El formato
// "0001-00000341" es el mismo que el de las facturas, así que reusamos
// formatearNumeroFactura de lib/formato.ts y le agregamos la "R".
// ─────────────────────────────────────────────────────────────
function formatearNumeroRecibo(numero: number) {
  return 'R ' + formatearNumeroFactura(PUNTO_VENTA, numero);
}

// ═════════════════════════════════════════════════════════════
// registrarPago — RF-C5
//
// clienteId: el [id] de la URL, como texto ("12"), sin validar
// datos (sin validar):
// {
//   "importe": 500000,             // centavos, entero positivo
//   "medio": "transferencia",      // efectivo | transferencia | tarjeta_debito
//   "observacion": "Pago parcial"  // opcional
// }
//
// Devuelve el recibo (sección 5.1):
// { id, numeroRecibo, fecha, cliente: {id, nombre}, importe, medio,
//   usuario: {id, nombre}, saldoCliente }
//
// Pueden cobrar admin y vendedor: no hay chequeo de rol.
//
// "any" porque los datos llegan tal cual del JSON, sin validar: el trabajo
// de esta función es justamente revisarlos campo por campo.
// ═════════════════════════════════════════════════════════════
export async function registrarPago(usuario: UsuarioSesion, clienteIdTexto: string, datos: any) {
  // ═══ 1. VALIDAR ═══

  // El id de la URL llega como texto. Number("abc") da NaN y
  // Number.isInteger(NaN) es false. Un id que no es número no puede
  // existir, así que respondemos 404 igual que si no estuviera.
  const clienteId = Number(clienteIdTexto);
  if (!Number.isInteger(clienteId) || clienteId < 1) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'El cliente no existe.');
  }

  const detalles: DetalleError[] = [];

  // importe: entero positivo en centavos (regla 10)
  if (!Number.isInteger(datos.importe) || datos.importe <= 0) {
    detalles.push({ campo: 'importe', mensaje: 'Tiene que ser un entero positivo, en centavos.' });
  }

  // medio: uno de los tres de la consigna
  if (datos.medio !== 'efectivo' && datos.medio !== 'transferencia' && datos.medio !== 'tarjeta_debito') {
    detalles.push({ campo: 'medio', mensaje: 'Tiene que ser efectivo, transferencia o tarjeta_debito.' });
  }

  // observacion: opcional. Vacía o ausente → null
  let observacion: string | null = null;
  if (datos.observacion !== undefined && datos.observacion !== null) {
    if (typeof datos.observacion !== 'string') {
      detalles.push({ campo: 'observacion', mensaje: 'Tiene que ser texto.' });
    } else if (datos.observacion.trim() !== '') {
      observacion = datos.observacion.trim();
    }
  }

  if (detalles.length > 0) {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }

  // A partir de acá los datos son válidos
  const importe: number = datos.importe;
  const medio: MedioApi = datos.medio;

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden registrar pagos.
  void usuario;

  // ═══ 3. REGLAS — todo dentro de UNA transacción ═══
  //
  // Qué es una transacción: un grupo de operaciones que la base trata
  // como UNA SOLA. O se graban todas, o no se graba ninguna.
  //
  // Por qué hace falta acá: el pago toca DOS tablas.
  //   1. pagos               → el recibo
  //   2. movimientos_cuenta  → el crédito que baja la deuda
  // Si se grabara el recibo y justo fallara el crédito, quedaría un
  // recibo cobrado que no descontó nada del saldo. Con la transacción,
  // si algo falla en el medio, la base deshace todo (rollback).
  //
  // Cómo se corta: se LANZA (throw) un ApiError adentro. Drizzle ve el
  // throw, deshace lo que se haya hecho y vuelve a lanzar el error; la
  // ruta lo atrapa con manejarError().
  //
  // "tx" es la conexión DENTRO de la transacción: todo lo que tiene que
  // quedar junto se hace con tx, no con db.
  const recibo = await db.transaction(async (tx) => {
    // --- El cliente ---
    const [cliente] = await tx.select().from(clientes).where(eq(clientes.id, clienteId));
    if (!cliente) {
      throw new ApiError(404, 'NO_ENCONTRADO', 'El cliente no existe.');
    }

    // Regla 6: sin cuenta corriente no tiene deuda que pagar
    if (!cliente.cuentaCorrienteHabilitada) {
      throw new ApiError(
        422,
        'CUENTA_CORRIENTE_NO_HABILITADA',
        'El cliente no tiene cuenta corriente habilitada.'
      );
    }

    // --- Regla 8: el pago no puede superar la deuda ---
    // El saldo se lee CON tx, dentro de la transacción, justo antes de
    // grabar. Así se usa el saldo de este momento y no uno viejo.
    const saldoActual = await calcularSaldoCliente(tx, clienteId);
    if (importe > saldoActual) {
      throw new ApiError(
        422,
        'PAGO_SUPERA_DEUDA',
        'El pago no puede superar la deuda del cliente.',
        [{ campo: 'importe', mensaje: `La deuda actual es de ${saldoActual} centavos.` }]
      );
    }

    // --- Regla 4: número de recibo ---
    // El más alto que existe + 1. Se asigna recién ahora, dentro de la
    // transacción: si algo falla, el número no se "gasta" y no quedan
    // huecos. Los recibos tienen su propia numeración, separada de las
    // facturas. "?? 0": si todavía no hay ningún pago, max da null.
    const [ultimo] = await tx.select({ maximo: max(pagos.numeroRecibo) }).from(pagos);
    const numeroRecibo = (ultimo.maximo ?? 0) + 1;
    const numeroReciboTexto = formatearNumeroRecibo(numeroRecibo);

    // La fecha la pone el servidor (regla 11), en ISO 8601 UTC
    const fecha = new Date().toISOString();

    // --- Grabar 1: el pago ---
    // .returning() devuelve la fila insertada, con el id que le dio la base
    const [pago] = await tx
      .insert(pagos)
      .values({
        numeroRecibo,
        clienteId,
        fecha,
        importeCentavos: importe,
        medio: medioABase(medio),
        observacion,
        usuarioId: usuario.id, // regla 11: quién lo cobró
      })
      .returning();

    // --- Grabar 2: el crédito en la cuenta corriente ---
    // Un pago es un CRÉDITO: baja lo que debe el cliente (regla 7).
    // pagoId une el movimiento con su recibo.
    await tx.insert(movimientosCuenta).values({
      clienteId,
      tipo: 'credito',
      importeCentavos: importe,
      fecha,
      descripcion: `Recibo ${numeroReciboTexto}`,
      facturaId: null,
      pagoId: pago.id,
    });

    // Si llegamos acá sin ningún throw, Drizzle confirma (commit) las dos
    // grabaciones juntas.

    // ═══ 4. DEVOLVER — el JSON de la sección 5.1 ═══
    return {
      id: pago.id,
      numeroRecibo: numeroReciboTexto,
      fecha,
      cliente: { id: cliente.id, nombre: cliente.nombre },
      importe,
      medio: medioAApi(pago.medio),
      usuario: { id: usuario.id, nombre: usuario.nombre },
      // El saldo que le queda: el de antes menos lo que pagó
      saldoCliente: saldoActual - importe,
    };
  });

  return recibo;
}
