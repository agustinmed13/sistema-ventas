// Servicio de CLIENTES — RF-C1, RF-C2, RF-C3, RF-C4, RF-C6, RF-C7
//
// Capa de servicios (AGENTS.md sección 3): ACÁ VIVEN LAS REGLAS DE CLIENTES.
// Este archivo no sabe nada de HTTP ni de cookies: recibe datos, los valida,
// habla con la base y devuelve un resultado. Las rutas de app/api/clientes/
// solo leen el pedido, llaman a estas funciones y responden.
//
// Cada función sigue siempre el mismo orden:
//   1. valida   2. verifica el permiso   3. aplica las reglas   4. devuelve
//
// Si algo no se puede hacer, se LANZA un ApiError (sección 10.4). La ruta lo
// atrapa y lo convierte en respuesta HTTP con manejarError().
//
// NOMBRES DE CAMPO (AGENTS.md sección 5.1): la API usa los nombres de la
// consigna (tipoDoc, nroDoc, cuentaCorriente, limiteCredito, saldo), que NO
// son los de las columnas de la base (tipoDocumento, numeroDocumento...).
// La traducción se hace en un solo lugar: la función aRespuesta(), más abajo.

import { eq, asc, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { clientes, movimientosCuenta } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';
import { listarFacturas } from '@/lib/servicios/facturas';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual)
type UsuarioSesion = { id: number; nombre: string; rol: 'admin' | 'vendedor' };

// Una fila de la tabla clientes, tal como la devuelve Drizzle
type FilaCliente = typeof clientes.$inferSelect;

// ─────────────────────────────────────────────────────────────
// Pasa un texto a minúsculas y le saca los acentos, para comparar
// sin que importe cómo lo escribió el usuario (RF-C1).
//   "Pérez" → "perez"      "MUÑOZ" → "munoz"
//
// Cómo funciona: normalize('NFD') separa cada letra acentuada en dos
// caracteres, la letra sola y el acento ("é" → "e" + "´"). Después el
// replace borra todos los acentos sueltos (el rango ̀-ͯ).
// ─────────────────────────────────────────────────────────────
function normalizarTexto(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

// ─────────────────────────────────────────────────────────────
// Le saca a un documento los puntos, guiones y espacios (RF-C1).
//   "28.456.123" → "28456123"      "20-28456123-4" → "20284561234"
// Así "28456123" encuentra a "28.456.123", y al revés.
// La expresión /[.\-\s]/g significa: "cada punto, guion o espacio".
// ─────────────────────────────────────────────────────────────
function limpiarDocumento(documento: string) {
  return documento.replace(/[.\-\s]/g, '');
}

// ─────────────────────────────────────────────────────────────
// Calcula el saldo de TODOS los clientes — regla 7: débitos − créditos.
//
// El saldo NO está guardado en ninguna columna: sale SIEMPRE de
// movimientos_cuenta (AGENTS.md sección 3). Le pedimos a la base,
// agrupando por cliente (GROUP BY):
//   - la suma de los importes de tipo 'debito'  (ventas a cuenta)
//   - la suma de los importes de tipo 'credito' (pagos y anulaciones)
// "coalesce(..., 0)" convierte en 0 la suma de un cliente que no tiene
// movimientos de ese tipo (si no, la base devolvería null).
//
// Devuelve una lista: [{ clienteId: 12, saldo: 8781000 }, ...]
// Un cliente sin movimientos no aparece: su saldo es 0.
// ─────────────────────────────────────────────────────────────
async function calcularSaldos() {
  const sumas = await db
    .select({
      clienteId: movimientosCuenta.clienteId,
      debitos: sql<number>`coalesce(sum(case when ${movimientosCuenta.tipo} = 'debito' then ${movimientosCuenta.importeCentavos} end), 0)`,
      creditos: sql<number>`coalesce(sum(case when ${movimientosCuenta.tipo} = 'credito' then ${movimientosCuenta.importeCentavos} end), 0)`,
    })
    .from(movimientosCuenta)
    .groupBy(movimientosCuenta.clienteId);

  return sumas.map((s) => ({
    clienteId: s.clienteId,
    saldo: Number(s.debitos) - Number(s.creditos), // regla 7
  }));
}

// ─────────────────────────────────────────────────────────────
// Calcula el saldo de UN cliente — regla 7: débitos − créditos.
// Es la misma cuenta que calcularSaldos(), pero para un solo cliente.
//
// "conexion" puede ser db (la conexión normal) o tx (una transacción).
// El servicio de pagos la llama con tx: así lee el saldo DENTRO de la
// misma transacción en la que graba el pago (ver lib/servicios/pagos.ts).
// Pick<typeof db, 'select'> = "cualquier cosa que tenga .select() como db".
// ─────────────────────────────────────────────────────────────
export async function calcularSaldoCliente(conexion: Pick<typeof db, 'select'>, clienteId: number) {
  const [suma] = await conexion
    .select({
      debitos: sql<number>`coalesce(sum(case when ${movimientosCuenta.tipo} = 'debito' then ${movimientosCuenta.importeCentavos} end), 0)`,
      creditos: sql<number>`coalesce(sum(case when ${movimientosCuenta.tipo} = 'credito' then ${movimientosCuenta.importeCentavos} end), 0)`,
    })
    .from(movimientosCuenta)
    .where(eq(movimientosCuenta.clienteId, clienteId));

  return Number(suma.debitos) - Number(suma.creditos); // regla 7
}

// ─────────────────────────────────────────────────────────────
// Traduce una fila de la base al JSON de la API (AGENTS.md sección 5.1).
// ACÁ ESTÁ LA ÚNICA TRADUCCIÓN de nombres: si la consigna cambia un nombre,
// se cambia solo acá.
//
//   columna de la base          →  campo de la API
//   tipoDocumento               →  tipoDoc
//   numeroDocumento             →  nroDoc
//   cuentaCorrienteHabilitada   →  cuentaCorriente
//   limiteCreditoCentavos       →  limiteCredito
//   (calculado)                 →  saldo, disponible
//
// "creadoEn" no figura en el JSON de la consigna, así que no se manda.
// ─────────────────────────────────────────────────────────────
function aRespuesta(cliente: FilaCliente, saldo: number) {
  // disponible = límite − saldo (sección 5.1). Sin límite, es null.
  let disponible: number | null = null;
  if (cliente.limiteCreditoCentavos !== null) {
    disponible = cliente.limiteCreditoCentavos - saldo;
  }

  return {
    id: cliente.id,
    tipoDoc: cliente.tipoDocumento,
    nroDoc: cliente.numeroDocumento,
    nombre: cliente.nombre,
    domicilio: cliente.domicilio,
    telefono: cliente.telefono,
    email: cliente.email,
    cuentaCorriente: cliente.cuentaCorrienteHabilitada,
    limiteCredito: cliente.limiteCreditoCentavos,
    saldo,
    disponible,
    activo: cliente.activo,
  };
}

// ═════════════════════════════════════════════════════════════
// listarClientes — RF-C1 (listado) y RF-C6 (saldos)
//
// filtros (sin validar, tal como vienen en la URL):
//   q          busca en el nombre o el documento (opcional)
//   conDeuda   "true" → solo clientes con saldo mayor a 0 (RF-C6)
//   orden      "nombre" (por defecto) o "saldo" (de mayor a menor)
//   page       desde 1 (por defecto 1)
//   pageSize   de 1 a 100 (por defecto 20)
//
// Devuelve { data, page, pageSize, total } (sección 11.1).
// Con conDeuda=true agrega totalAdeudado: la suma de los saldos de TODOS
// los clientes con deuda (no solo los de la página).
// ═════════════════════════════════════════════════════════════
type FiltrosClientes = {
  q: string | null;
  conDeuda: string | null;
  orden: string | null;
  page: string | null;
  pageSize: string | null;
};

export async function listarClientes(usuario: UsuarioSesion, filtros: FiltrosClientes) {
  // ═══ 1. VALIDAR ═══
  // Juntamos todos los errores de los parámetros en "detalles".
  // Los parámetros de la URL siempre llegan como texto: "2", "abc"...
  // Number("abc") da NaN, y Number.isInteger(NaN) es false: así se rechazan.
  const detalles: DetalleError[] = [];

  let page = 1;
  if (filtros.page !== null) {
    page = Number(filtros.page);
    if (!Number.isInteger(page) || page < 1) {
      detalles.push({ campo: 'page', mensaje: 'Tiene que ser un entero desde 1.' });
    }
  }
  let pageSize = 20;
  if (filtros.pageSize !== null) {
    pageSize = Number(filtros.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      detalles.push({ campo: 'pageSize', mensaje: 'Tiene que ser un entero entre 1 y 100.' });
    }
  }

  // conDeuda: solo se acepta "true" o "false". Si no viene, es false.
  let conDeuda = false;
  if (filtros.conDeuda !== null) {
    if (filtros.conDeuda === 'true') {
      conDeuda = true;
    } else if (filtros.conDeuda !== 'false') {
      detalles.push({ campo: 'conDeuda', mensaje: 'Tiene que ser true o false.' });
    }
  }

  // orden: "nombre" o "saldo". Si no viene, por nombre.
  let orden = 'nombre';
  if (filtros.orden !== null) {
    if (filtros.orden === 'nombre' || filtros.orden === 'saldo') {
      orden = filtros.orden;
    } else {
      detalles.push({ campo: 'orden', mensaje: 'Tiene que ser nombre o saldo.' });
    }
  }

  if (detalles.length > 0) {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden ver clientes: no hay chequeo de rol.
  // (Que haya sesión ya lo verificó la ruta.)
  void usuario;

  // ═══ 3. REGLAS ═══

  // Traer todos los clientes y el saldo de cada uno (regla 7)
  const filas = await db.select().from(clientes);
  const saldos = await calcularSaldos();

  // Armar cada cliente con los nombres de la API
  let lista = filas.map((fila) => {
    const encontrado = saldos.find((s) => s.clienteId === fila.id);
    let saldo = 0;
    if (encontrado) saldo = encontrado.saldo;
    return aRespuesta(fila, saldo);
  });

  // Filtrar por q — RF-C1.
  // Lo hacemos acá en TypeScript y no en SQL porque SQLite no sabe ignorar
  // acentos: para él "Pérez" y "perez" son textos distintos.
  //   - en el nombre: sin mayúsculas ni acentos
  //   - en el documento: además sin puntos ni guiones ("28456123" encuentra
  //     a "28.456.123")
  // Si q no vino o vino vacío, no se filtra nada.
  if (filtros.q !== null && filtros.q.trim() !== '') {
    const buscadoNombre = normalizarTexto(filtros.q.trim());
    const buscadoDocumento = limpiarDocumento(filtros.q.trim());
    lista = lista.filter((c) => {
      const coincideNombre = normalizarTexto(c.nombre).includes(buscadoNombre);
      // Si q era solo puntos o guiones, buscadoDocumento queda vacío y
      // "".includes("") daría true para todos: por eso se chequea que no esté vacío.
      const coincideDocumento =
        buscadoDocumento !== '' && limpiarDocumento(c.nroDoc).includes(buscadoDocumento);
      return coincideNombre || coincideDocumento;
    });
  }

  // Filtrar por deuda — RF-C6: solo los que deben algo
  if (conDeuda) {
    lista = lista.filter((c) => c.saldo > 0);
  }

  // Ordenar
  if (orden === 'saldo') {
    // RF-C6: de mayor a menor deuda. (b − a) pone primero al más grande.
    lista.sort((a, b) => b.saldo - a.saldo);
  } else {
    // Por nombre. localeCompare con 'es' ordena como en español:
    // "Álvarez" va con las A, sin importar mayúsculas.
    lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  }

  // Cortar la página pedida:
  //   page 1 → del 0 al 19;  page 2 → del 20 al 39;  etc.
  const desde = (page - 1) * pageSize;
  const data = lista.slice(desde, desde + pageSize);

  // ═══ 4. DEVOLVER ═══
  // total = cuántos clientes cumplen los filtros (no solo los de esta página)
  if (conDeuda) {
    // RF-C6: total adeudado = suma de los saldos de todos los que deben
    let totalAdeudado = 0;
    for (const c of lista) {
      totalAdeudado = totalAdeudado + c.saldo;
    }
    return { data, page, pageSize, total: lista.length, totalAdeudado };
  }
  return { data, page, pageSize, total: lista.length };
}

// ─────────────────────────────────────────────────────────────
// Un campo de texto opcional (domicilio, teléfono, email):
//   - si vino null, o vino vacío → null
//   - si vino como texto         → el texto sin espacios de los costados
//   - si vino otra cosa          → undefined (lo usamos para marcar error)
// ─────────────────────────────────────────────────────────────
function textoOpcional(valor: unknown): string | null | undefined {
  if (valor === null) return null;
  if (typeof valor !== 'string') return undefined;
  if (valor.trim() === '') return null;
  return valor.trim();
}

// Los datos de un cliente ya validados, con los nombres de la API.
// Cada campo es opcional ("?") porque en la edición solo vienen los que
// se quieren cambiar.
type DatosCliente = {
  tipoDoc?: 'DNI' | 'CUIT';
  nroDoc?: string;
  nombre?: string;
  domicilio?: string | null;
  telefono?: string | null;
  email?: string | null;
  cuentaCorriente?: boolean;
  limiteCredito?: number | null;
};

// ═════════════════════════════════════════════════════════════
// validarDatosCliente — RF-C2
//
// ACÁ ESTÁN TODAS LAS VALIDACIONES DE CAMPO DEL CLIENTE. Las usan el alta
// (crearCliente) y la edición (actualizarCliente), así cada regla vive en
// un solo lugar: si mañana el nombre tiene un largo máximo, se agrega acá.
//
// esAlta = true  → tipoDoc, nroDoc y nombre son OBLIGATORIOS.
// esAlta = false → (edición) solo se revisan los campos que vinieron;
//                  los que no vinieron no se tocan.
//
// Si algún campo está mal, lanza 422 VALIDACION con TODOS los errores
// juntos en "details", así el formulario puede marcarlos a la vez.
// ═════════════════════════════════════════════════════════════
function validarDatosCliente(datos: any, esAlta: boolean): DatosCliente {
  const detalles: DetalleError[] = [];
  const valores: DatosCliente = {};

  // tipoDoc: solo 'DNI' o 'CUIT'
  if (esAlta || datos.tipoDoc !== undefined) {
    if (datos.tipoDoc !== 'DNI' && datos.tipoDoc !== 'CUIT') {
      detalles.push({ campo: 'tipoDoc', mensaje: 'Tiene que ser DNI o CUIT.' });
    } else {
      valores.tipoDoc = datos.tipoDoc;
    }
  }

  // nroDoc: obligatorio, no vacío. Primero chequeamos que sea texto,
  // porque si llega un número, .replace() no existe y explotaría.
  // Se guarda SIN puntos ni guiones: "28.456.123" → "28456123". Los puntos
  // se agregan solo al mostrarlo, con formatearDocumento() de
  // lib/formato.ts, que espera recibirlo así.
  if (esAlta || datos.nroDoc !== undefined) {
    if (typeof datos.nroDoc !== 'string' || limpiarDocumento(datos.nroDoc) === '') {
      detalles.push({ campo: 'nroDoc', mensaje: 'Es obligatorio.' });
    } else {
      valores.nroDoc = limpiarDocumento(datos.nroDoc);
    }
  }

  // nombre: obligatorio, no vacío
  if (esAlta || datos.nombre !== undefined) {
    if (typeof datos.nombre !== 'string' || datos.nombre.trim() === '') {
      detalles.push({ campo: 'nombre', mensaje: 'Es obligatorio.' });
    } else {
      valores.nombre = datos.nombre.trim();
    }
  }

  // domicilio, telefono, email: opcionales. Si vienen, texto o null.
  // Mandar null o "" los borra.
  if (datos.domicilio !== undefined) {
    const domicilio = textoOpcional(datos.domicilio);
    if (domicilio === undefined) detalles.push({ campo: 'domicilio', mensaje: 'Tiene que ser texto.' });
    else valores.domicilio = domicilio;
  }
  if (datos.telefono !== undefined) {
    const telefono = textoOpcional(datos.telefono);
    if (telefono === undefined) detalles.push({ campo: 'telefono', mensaje: 'Tiene que ser texto.' });
    else valores.telefono = telefono;
  }
  if (datos.email !== undefined) {
    const email = textoOpcional(datos.email);
    if (email === undefined) detalles.push({ campo: 'email', mensaje: 'Tiene que ser texto.' });
    else valores.email = email;
  }

  // cuentaCorriente: true o false
  if (datos.cuentaCorriente !== undefined) {
    if (typeof datos.cuentaCorriente !== 'boolean') {
      detalles.push({ campo: 'cuentaCorriente', mensaje: 'Tiene que ser true o false.' });
    } else {
      valores.cuentaCorriente = datos.cuentaCorriente;
    }
  }

  // limiteCredito: null (sin límite) o entero positivo — regla 10:
  // importes en centavos enteros, así que no se aceptan decimales.
  // Number.isInteger rechaza de una vez textos y decimales.
  if (datos.limiteCredito !== undefined) {
    if (datos.limiteCredito === null) {
      valores.limiteCredito = null;
    } else if (!Number.isInteger(datos.limiteCredito) || datos.limiteCredito <= 0) {
      detalles.push({ campo: 'limiteCredito', mensaje: 'Tiene que ser un entero positivo, en centavos.' });
    } else {
      valores.limiteCredito = datos.limiteCredito;
    }
  }

  if (detalles.length > 0) {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }
  return valores;
}

// ─────────────────────────────────────────────────────────────
// El par tipo + número de documento es único (RF-C2).
// Lanza 409 DOCUMENTO_DUPLICADO si ya hay OTRO cliente con ese documento.
//
// Comparamos SIN puntos ni guiones: "28.456.123" y "28456123" son el mismo
// DNI aunque estén escritos distinto. Por eso no alcanza con un WHERE de
// igualdad en SQL: traemos los clientes y comparamos acá.
//
// idPropio: en la edición, el id del cliente que se edita, para que no
// choque consigo mismo. En el alta, null.
//
// Es 409 y no 422: el pedido está bien, pero choca con un dato que YA
// EXISTE en la base (criterio de la sección 11.8).
// ─────────────────────────────────────────────────────────────
async function verificarDocumentoUnico(tipoDoc: string, nroDoc: string, idPropio: number | null) {
  const todos = await db.select().from(clientes);
  const repetido = todos.find(
    (c) =>
      c.id !== idPropio &&
      c.tipoDocumento === tipoDoc &&
      limpiarDocumento(c.numeroDocumento) === limpiarDocumento(nroDoc)
  );
  if (repetido) {
    throw new ApiError(409, 'DOCUMENTO_DUPLICADO', `Ya existe un cliente con ${tipoDoc} ${nroDoc}.`, [
      { campo: 'nroDoc', mensaje: 'Ya existe.' },
    ]);
  }
}

// ═════════════════════════════════════════════════════════════
// crearCliente — RF-C2
//
// datos (sin validar), con los nombres de la sección 5.1:
// {
//   "tipoDoc": "DNI",                 // DNI o CUIT
//   "nroDoc": "28.456.123",
//   "nombre": "Mariana López",
//   "domicilio": "Las Heras 455",     // opcional
//   "telefono": "381 455-2210",       // opcional
//   "email": "mariana@correo.test",   // opcional
//   "cuentaCorriente": true,          // opcional, por defecto false
//   "limiteCredito": 40000000         // opcional, en centavos
// }
//
// El id y la fecha de creación los asigna el servidor. Si el pedido los
// trae, se ignoran: la fila se arma campo por campo más abajo.
//
// "any" porque los datos llegan tal cual del JSON, sin validar.
// ═════════════════════════════════════════════════════════════
export async function crearCliente(usuario: UsuarioSesion, datos: any) {
  // ═══ 1. VALIDAR ═══ (esAlta = true: tipoDoc, nroDoc y nombre obligatorios)
  const valores = validarDatosCliente(datos, true);

  // Los obligatorios seguro vinieron (si no, validarDatosCliente lanzó 422).
  // El "as" se lo confirma a TypeScript.
  const tipoDoc = valores.tipoDoc as 'DNI' | 'CUIT';
  const nroDoc = valores.nroDoc as string;
  const nombre = valores.nombre as string;

  // Los opcionales que no vinieron quedan en su valor por defecto.
  // "??" significa: "si lo de la izquierda es undefined o null, usá lo de la derecha".
  const domicilio = valores.domicilio ?? null;
  const telefono = valores.telefono ?? null;
  const email = valores.email ?? null;
  const cuentaCorriente = valores.cuentaCorriente ?? false;
  let limiteCredito = valores.limiteCredito ?? null;

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden dar de alta clientes: no hay chequeo de rol.
  void usuario;

  // ═══ 3. REGLAS ═══

  // Sin cuenta corriente el límite de crédito no tiene sentido: queda en
  // null aunque lo hayan mandado (RF-C2, regla 7).
  if (!cuentaCorriente) {
    limiteCredito = null;
  }

  // Documento único (RF-C2)
  await verificarDocumentoUnico(tipoDoc, nroDoc, null);


  // Guardar. Acá se traduce al revés: de los nombres de la API a las
  // columnas de la base. La fecha la pone el servidor, en ISO 8601 UTC.
  // Toca una sola tabla, así que no hace falta transacción.
  // .returning() devuelve la fila insertada, con el id que le asignó la base.
  const filas = await db
    .insert(clientes)
    .values({
      tipoDocumento: tipoDoc,
      numeroDocumento: nroDoc,
      nombre,
      domicilio,
      telefono,
      email,
      cuentaCorrienteHabilitada: cuentaCorriente,
      limiteCreditoCentavos: limiteCredito,
      activo: true,
      creadoEn: new Date().toISOString(),
    })
    .returning();

  // ═══ 4. DEVOLVER ═══
  // Un cliente recién creado no tiene movimientos: su saldo es 0 (regla 7)
  return aRespuesta(filas[0], 0);
}

// ─────────────────────────────────────────────────────────────
// Busca un cliente por el id que viene en la URL, o lanza 404.
// El id llega como texto ("12"). Number("abc") da NaN y
// Number.isInteger(NaN) es false: un id que no es número no puede
// existir, así que respondemos 404 igual que si no estuviera.
// ─────────────────────────────────────────────────────────────
async function buscarClienteOFallar(idTexto: string) {
  const id = Number(idTexto);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'El cliente no existe.');
  }
  const [cliente] = await db.select().from(clientes).where(eq(clientes.id, id));
  if (!cliente) {
    throw new ApiError(404, 'NO_ENCONTRADO', 'El cliente no existe.');
  }
  return cliente;
}

// ─────────────────────────────────────────────────────────────
// Convierte un día "AAAA-MM-DD" de Argentina al instante UTC en que
// EMPIEZA ese día (sección 11.1: los filtros por día son en hora argentina).
//   "2026-11-21" → 2026-11-21 a las 00:00 en Argentina (UTC−3)
//                → "2026-11-21T03:00:00.000Z" en UTC
// Devuelve null si el texto no tiene el formato correcto.
// Es la misma conversión que usa listarFacturas en facturas.ts.
// ─────────────────────────────────────────────────────────────
function inicioDelDiaArgentina(dia: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  const fecha = new Date(dia + 'T00:00:00-03:00');
  if (isNaN(fecha.getTime())) return null; // por ejemplo "2026-13-45"
  return fecha;
}

// ═════════════════════════════════════════════════════════════
// obtenerCuentaCorriente — RF-C4
//
// clienteIdTexto: el [id] de la URL, sin validar
// filtros (sin validar, de la URL):
//   desde   AAAA-MM-DD, opcional (día de Argentina, incluido)
//   hasta   AAAA-MM-DD, opcional (día de Argentina, incluido)
//
// Devuelve (AGENTS.md sección 5.1):
// {
//   cliente: { id, nombre },
//   saldoAnterior,   lo que debía ANTES de "desde" (0 si no hay desde)
//   movimientos: [ { fecha, tipo, importe, descripcion, facturaId,
//                    pagoId, saldo }, ... ]   en orden cronológico
//   saldo            el saldo al final del período
// }
//
// Cada renglón trae el SALDO ACUMULADO: cuánto debía el cliente justo
// después de ese movimiento. Es como el extracto de un banco.
//
// Los dos roles pueden consultar: no hay chequeo de rol.
// ═════════════════════════════════════════════════════════════
type FiltrosCuenta = {
  desde: string | null;
  hasta: string | null;
};

export async function obtenerCuentaCorriente(
  usuario: UsuarioSesion,
  clienteIdTexto: string,
  filtros: FiltrosCuenta
) {
  // ═══ 1. VALIDAR ═══
  const detalles: DetalleError[] = [];

  // desde: el período empieza a las 00:00 de ese día en Argentina
  let inicio: string | null = null;
  if (filtros.desde !== null) {
    const fecha = inicioDelDiaArgentina(filtros.desde);
    if (fecha === null) {
      detalles.push({ campo: 'desde', mensaje: 'Tiene que tener el formato AAAA-MM-DD.' });
    } else {
      inicio = fecha.toISOString();
    }
  }

  // hasta: el período termina ANTES de las 00:00 del día SIGUIENTE, así
  // el día "hasta" queda incluido completo.
  let fin: string | null = null;
  if (filtros.hasta !== null) {
    const fecha = inicioDelDiaArgentina(filtros.hasta);
    if (fecha === null) {
      detalles.push({ campo: 'hasta', mensaje: 'Tiene que tener el formato AAAA-MM-DD.' });
    } else {
      const UN_DIA_MS = 24 * 60 * 60 * 1000;
      fin = new Date(fecha.getTime() + UN_DIA_MS).toISOString();
    }
  }

  // Las fechas ISO se pueden comparar como texto: "2026-11-21..." < "2026-11-22..."
  if (inicio !== null && fin !== null && inicio >= fin) {
    detalles.push({ campo: 'hasta', mensaje: 'No puede ser anterior a "desde".' });
  }

  if (detalles.length > 0) {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden ver la cuenta corriente.
  void usuario;

  // ═══ 3. REGLAS ═══
  const cliente = await buscarClienteOFallar(clienteIdTexto);

  // Todos los movimientos del cliente, del más viejo al más nuevo.
  // Si dos tienen la misma fecha, desempata el id (el que se grabó primero).
  const todos = await db
    .select()
    .from(movimientosCuenta)
    .where(eq(movimientosCuenta.clienteId, cliente.id))
    .orderBy(asc(movimientosCuenta.fecha), asc(movimientosCuenta.id));

  // Recorremos los movimientos en orden y los repartimos en tres grupos:
  //   - ANTES de "desde"   → no se muestran, pero se suman en saldoAnterior
  //   - DENTRO del período → se muestran, cada uno con su saldo acumulado
  //   - DESPUÉS de "hasta" → se ignoran
  // El saldo se va acumulando con la regla 7: débito suma, crédito resta.
  let saldoAnterior = 0;
  let saldo = 0;
  const movimientos = [];

  for (const mov of todos) {
    // Después del período: no cuenta
    if (fin !== null && mov.fecha >= fin) continue;

    // Débito suma a la deuda, crédito la baja (regla 7)
    let cambio = mov.importeCentavos;
    if (mov.tipo === 'credito') cambio = -mov.importeCentavos;

    if (inicio !== null && mov.fecha < inicio) {
      // Antes del período: solo se acumula en el saldo anterior
      saldoAnterior = saldoAnterior + cambio;
      saldo = saldoAnterior;
    } else {
      // Dentro del período: se muestra con el saldo acumulado hasta acá
      saldo = saldo + cambio;
      movimientos.push({
        fecha: mov.fecha,
        tipo: mov.tipo,
        importe: mov.importeCentavos, // sección 5.1: sin sufijo Centavos
        descripcion: mov.descripcion,
        facturaId: mov.facturaId,
        pagoId: mov.pagoId,
        saldo,
      });
    }
  }

  // ═══ 4. DEVOLVER ═══
  return {
    cliente: { id: cliente.id, nombre: cliente.nombre },
    saldoAnterior,
    movimientos,
    saldo, // sin "hasta", es el saldo actual del cliente
  };
}

// ═════════════════════════════════════════════════════════════
// obtenerCliente — RF-C3 (ficha del cliente)
//
// Devuelve el cliente con el JSON de la sección 5.1, más ultimasFacturas:
// sus 6 facturas más recientes.
//
// Las facturas las pide al servicio de facturas (listarFacturas), con el
// filtro clienteId. Así salen con el mismo formato que el listado de
// ventas, y ese formato vive en un solo lugar (lib/servicios/facturas.ts).
//
// Los dos roles pueden consultar: no hay chequeo de rol.
// ═════════════════════════════════════════════════════════════
export async function obtenerCliente(usuario: UsuarioSesion, clienteIdTexto: string) {
  // ═══ 1. VALIDAR + 3. REGLAS ═══
  // Lo único que hay que validar es el id, y lo hace buscarClienteOFallar
  // (404 si no es un número o no existe).
  const cliente = await buscarClienteOFallar(clienteIdTexto);

  // Saldo del cliente (regla 7)
  const saldo = await calcularSaldoCliente(db, cliente.id);

  // Las 6 últimas facturas (las más nuevas primero, así ordena listarFacturas)
  const facturasDelCliente = await listarFacturas(usuario, {
    q: null,
    desde: null,
    hasta: null,
    clienteId: String(cliente.id),
    vendedorId: null,
    forma: null,
    estado: null,
    page: '1',
    pageSize: '6',
  });

  // ═══ 4. DEVOLVER ═══
  // "..." copia todos los campos del cliente y le agrega ultimasFacturas
  return {
    ...aRespuesta(cliente, saldo),
    ultimasFacturas: facturasDelCliente.data,
  };
}

// ═════════════════════════════════════════════════════════════
// actualizarCliente — RF-C2 (edición) y RF-C7 (baja lógica)
//
// datos (sin validar): cualquier campo del alta, más "activo".
// Solo se cambian los campos que vienen; los demás quedan como estaban.
//   { "telefono": "381 555-0000" }        → cambia solo el teléfono
//   { "activo": false }                   → baja lógica (regla 12)
//   { "cuentaCorriente": false }          → le quita la cuenta corriente
//
// Reglas:
//   - 422 SALDO_PENDIENTE si se lo desactiva o se le quita la cuenta
//     corriente teniendo saldo distinto de cero (sección 11.5)
//   - sin cuenta corriente, el límite queda en null (igual que en el alta)
//   - si cambia el documento, tiene que seguir siendo único (409)
//
// Nunca se borra un cliente: la baja es "activo": false (regla 12).
// Los dos roles pueden editar (la consigna no la marca como admin).
// ═════════════════════════════════════════════════════════════
export async function actualizarCliente(usuario: UsuarioSesion, clienteIdTexto: string, datos: any) {
  // ═══ 1. VALIDAR ═══
  // esAlta = false: solo se revisan los campos que vinieron
  const valores = validarDatosCliente(datos, false);

  // activo: solo existe en la edición, por eso se valida acá
  let activo: boolean | undefined = undefined;
  if (datos.activo !== undefined) {
    if (typeof datos.activo !== 'boolean') {
      throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', [
        { campo: 'activo', mensaje: 'Tiene que ser true o false.' },
      ]);
    }
    activo = datos.activo;
  }

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden editar clientes.
  void usuario;

  // ═══ 3. REGLAS ═══
  const cliente = await buscarClienteOFallar(clienteIdTexto);

  // Cómo queda el cliente después del cambio: lo que vino, o si no vino,
  // lo que ya tenía. "??" = "si lo de la izquierda es undefined, usá lo
  // de la derecha". Ojo: para los campos que aceptan null (domicilio,
  // límite...) se usa "!== undefined", porque null SÍ es un valor nuevo
  // (significa "borralo") y "??" lo confundiría con "no vino".
  const tipoDoc = valores.tipoDoc ?? cliente.tipoDocumento;
  const nroDoc = valores.nroDoc ?? cliente.numeroDocumento;
  const nombre = valores.nombre ?? cliente.nombre;
  const domicilio = valores.domicilio !== undefined ? valores.domicilio : cliente.domicilio;
  const telefono = valores.telefono !== undefined ? valores.telefono : cliente.telefono;
  const email = valores.email !== undefined ? valores.email : cliente.email;
  const cuentaCorriente = valores.cuentaCorriente ?? cliente.cuentaCorrienteHabilitada;
  let limiteCredito =
    valores.limiteCredito !== undefined ? valores.limiteCredito : cliente.limiteCreditoCentavos;
  const activoFinal = activo ?? cliente.activo;

  // Sección 11.5: no se puede dar de baja ni quitar la cuenta corriente a
  // un cliente que todavía tiene saldo. Si se pudiera, quedaría una deuda
  // que nadie ve ni puede cobrar.
  const saldo = await calcularSaldoCliente(db, cliente.id);
  const loDesactivan = activo === false;
  const leQuitanLaCuenta = valores.cuentaCorriente === false;
  if ((loDesactivan || leQuitanLaCuenta) && saldo !== 0) {
    throw new ApiError(
      422,
      'SALDO_PENDIENTE',
      `El cliente tiene un saldo de ${saldo} centavos. Tiene que quedar en cero primero.`
    );
  }

  // Sin cuenta corriente, el límite no tiene sentido (igual que en el alta)
  if (!cuentaCorriente) {
    limiteCredito = null;
  }

  // Si cambió el documento, tiene que seguir siendo único (RF-C2).
  // Se pasa el id propio para que no choque consigo mismo.
  if (valores.tipoDoc !== undefined || valores.nroDoc !== undefined) {
    await verificarDocumentoUnico(tipoDoc, nroDoc, cliente.id);
  }

  // Guardar. Se traduce de los nombres de la API a las columnas.
  // Toca una sola tabla, así que no hace falta transacción.
  const [actualizado] = await db
    .update(clientes)
    .set({
      tipoDocumento: tipoDoc,
      numeroDocumento: nroDoc,
      nombre,
      domicilio,
      telefono,
      email,
      cuentaCorrienteHabilitada: cuentaCorriente,
      limiteCreditoCentavos: limiteCredito,
      activo: activoFinal,
    })
    .where(eq(clientes.id, cliente.id))
    .returning();

  // ═══ 4. DEVOLVER ═══ el cliente actualizado, con el JSON de la 5.1
  return aRespuesta(actualizado, saldo);
}
