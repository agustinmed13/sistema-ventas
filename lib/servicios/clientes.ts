// Servicio de CLIENTES — RF-C1, RF-C2, RF-C6
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

import { eq, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { clientes, movimientosCuenta } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';

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
//   - si no vino, o vino vacío → null
//   - si vino como texto       → el texto sin espacios de los costados
//   - si vino otra cosa        → undefined (lo usamos para marcar error)
// ─────────────────────────────────────────────────────────────
function textoOpcional(valor: unknown): string | null | undefined {
  if (valor === undefined || valor === null) return null;
  if (typeof valor !== 'string') return undefined;
  if (valor.trim() === '') return null;
  return valor.trim();
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
// "any" porque los datos llegan tal cual del JSON, sin validar: el trabajo
// de esta función es justamente revisarlos campo por campo.
// ═════════════════════════════════════════════════════════════
export async function crearCliente(usuario: UsuarioSesion, datos: any) {
  // ═══ 1. VALIDAR ═══
  // Juntamos TODOS los errores de campo en "detalles", así el formulario
  // puede marcar varios campos a la vez en lugar de uno por vez.
  const detalles: DetalleError[] = [];

  // tipoDoc: solo 'DNI' o 'CUIT'
  if (datos.tipoDoc !== 'DNI' && datos.tipoDoc !== 'CUIT') {
    detalles.push({ campo: 'tipoDoc', mensaje: 'Tiene que ser DNI o CUIT.' });
  }

  // nroDoc y nombre: obligatorios. Primero chequeamos que sean texto,
  // porque si llega un número, .trim() no existe y explotaría.
  if (typeof datos.nroDoc !== 'string' || datos.nroDoc.trim() === '') {
    detalles.push({ campo: 'nroDoc', mensaje: 'Es obligatorio.' });
  }
  if (typeof datos.nombre !== 'string' || datos.nombre.trim() === '') {
    detalles.push({ campo: 'nombre', mensaje: 'Es obligatorio.' });
  }

  // domicilio, telefono, email: opcionales, pero si vienen tienen que ser texto
  const domicilio = textoOpcional(datos.domicilio);
  if (domicilio === undefined) detalles.push({ campo: 'domicilio', mensaje: 'Tiene que ser texto.' });
  const telefono = textoOpcional(datos.telefono);
  if (telefono === undefined) detalles.push({ campo: 'telefono', mensaje: 'Tiene que ser texto.' });
  const email = textoOpcional(datos.email);
  if (email === undefined) detalles.push({ campo: 'email', mensaje: 'Tiene que ser texto.' });

  // cuentaCorriente: si no vino, queda en false
  let cuentaCorriente = false;
  if (datos.cuentaCorriente !== undefined) {
    if (typeof datos.cuentaCorriente !== 'boolean') {
      detalles.push({ campo: 'cuentaCorriente', mensaje: 'Tiene que ser true o false.' });
    } else {
      cuentaCorriente = datos.cuentaCorriente;
    }
  }

  // limiteCredito: opcional. Si viene, entero positivo — regla 10:
  // importes en centavos enteros, así que no se aceptan decimales.
  // Number.isInteger rechaza de una vez textos, decimales y null.
  let limiteCredito: number | null = null;
  if (datos.limiteCredito !== undefined && datos.limiteCredito !== null) {
    if (!Number.isInteger(datos.limiteCredito) || datos.limiteCredito <= 0) {
      detalles.push({
        campo: 'limiteCredito',
        mensaje: 'Tiene que ser un entero positivo, en centavos.',
      });
    } else {
      limiteCredito = datos.limiteCredito;
    }
  }

  // Si hubo algún error de campo, cortamos acá con 422 y la lista completa
  if (detalles.length > 0) {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }

  // A partir de acá sabemos que los datos son válidos
  const tipoDoc: 'DNI' | 'CUIT' = datos.tipoDoc;
  // El documento se guarda SIN puntos ni guiones: "28.456.123" → "28456123".
  // Los puntos se agregan solo al mostrarlo, con formatearDocumento() de
  // lib/formato.ts, que espera recibirlo así.
  const nroDoc: string = limpiarDocumento(datos.nroDoc.trim());
  const nombre: string = datos.nombre.trim();

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden dar de alta clientes: no hay chequeo de rol.
  void usuario;

  // ═══ 3. REGLAS ═══

  // Sin cuenta corriente el límite de crédito no tiene sentido: queda en
  // null aunque lo hayan mandado (RF-C2, regla 7).
  if (!cuentaCorriente) {
    limiteCredito = null;
  }

  // El par tipo + número de documento es único (RF-C2).
  // Comparamos SIN puntos ni guiones: "28.456.123" y "28456123" son el mismo
  // DNI aunque estén escritos distinto. Por eso no alcanza con un WHERE
  // de igualdad en SQL: traemos los clientes y comparamos acá.
  // Es 409 y no 422: el pedido está bien, pero choca con un dato que YA
  // EXISTE en la base (criterio de la sección 11.8).
  const todos = await db.select().from(clientes);
  const repetido = todos.find(
    (c) =>
      c.tipoDocumento === tipoDoc &&
      limpiarDocumento(c.numeroDocumento) === limpiarDocumento(nroDoc)
  );
  if (repetido) {
    throw new ApiError(409, 'DOCUMENTO_DUPLICADO', `Ya existe un cliente con ${tipoDoc} ${nroDoc}.`, [
      { campo: 'nroDoc', mensaje: 'Ya existe.' },
    ]);
  }

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
