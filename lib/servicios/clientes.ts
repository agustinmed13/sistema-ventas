// Servicio de CLIENTES — RF-C1, RF-C2
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

import { eq, and, sql } from 'drizzle-orm';
import { db } from '@/db/index';
import { clientes, movimientosCuenta } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual)
type UsuarioSesion = { id: number; nombre: string; rol: 'admin' | 'vendedor' };

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

// ═════════════════════════════════════════════════════════════
// listarClientes — RF-C1
//
// filtros (sin validar, tal como vienen en la URL):
//   q          busca en el nombre o el número de documento (opcional)
//   page       desde 1 (por defecto 1)
//   pageSize   de 1 a 100 (por defecto 20)
//
// Devuelve { data, page, pageSize, total } (sección 11.1).
// Cada cliente viene con su saldoCentavos (regla 7).
// ═════════════════════════════════════════════════════════════
type FiltrosClientes = {
  q: string | null;
  page: string | null;
  pageSize: string | null;
};

export async function listarClientes(usuario: UsuarioSesion, filtros: FiltrosClientes) {
  // ═══ 1. VALIDAR ═══
  // Los parámetros de la URL siempre llegan como texto: "2", "abc"...
  // Number("abc") da NaN, y Number.isInteger(NaN) es false: así se rechazan.
  let page = 1;
  if (filtros.page !== null) {
    page = Number(filtros.page);
    if (!Number.isInteger(page) || page < 1) {
      throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', [
        { campo: 'page', mensaje: 'Tiene que ser un entero desde 1.' },
      ]);
    }
  }
  let pageSize = 20;
  if (filtros.pageSize !== null) {
    pageSize = Number(filtros.pageSize);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', [
        { campo: 'pageSize', mensaje: 'Tiene que ser un entero entre 1 y 100.' },
      ]);
    }
  }

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden ver clientes: no hay chequeo de rol.
  // (Que haya sesión ya lo verificó la ruta.)
  void usuario;

  // ═══ 3. REGLAS ═══

  // Traer todos los clientes
  const todos = await db.select().from(clientes);

  // Calcular el saldo — regla 7: saldo = débitos − créditos.
  // El saldo NO está guardado en ninguna columna: sale SIEMPRE de
  // movimientos_cuenta. Le pedimos a la base, agrupando por cliente:
  //   - la suma de los importes de tipo 'debito'  (ventas a cuenta)
  //   - la suma de los importes de tipo 'credito' (pagos y anulaciones)
  // "coalesce(..., 0)" convierte en 0 la suma de un cliente que no tiene
  // movimientos de ese tipo (si no, la base devolvería null).
  const sumas = await db
    .select({
      clienteId: movimientosCuenta.clienteId,
      debitos: sql<number>`coalesce(sum(case when ${movimientosCuenta.tipo} = 'debito' then ${movimientosCuenta.importeCentavos} end), 0)`,
      creditos: sql<number>`coalesce(sum(case when ${movimientosCuenta.tipo} = 'credito' then ${movimientosCuenta.importeCentavos} end), 0)`,
    })
    .from(movimientosCuenta)
    .groupBy(movimientosCuenta.clienteId);

  // Le agregamos el saldo a cada cliente.
  // Un cliente sin movimientos no aparece en "sumas": su saldo es 0.
  const conSaldo = todos.map((cliente) => {
    const suma = sumas.find((s) => s.clienteId === cliente.id);
    let saldoCentavos = 0;
    if (suma) {
      saldoCentavos = Number(suma.debitos) - Number(suma.creditos); // regla 7
    }
    return { ...cliente, saldoCentavos };
  });

  // Filtrar por q — RF-C1.
  // Lo hacemos acá en TypeScript y no en SQL porque SQLite no sabe ignorar
  // acentos: para él "Pérez" y "perez" son textos distintos.
  // Si q no vino o vino vacío, no se filtra nada.
  let filtrados = conSaldo;
  if (filtros.q !== null && filtros.q.trim() !== '') {
    const buscado = normalizarTexto(filtros.q.trim());
    filtrados = conSaldo.filter(
      (c) =>
        normalizarTexto(c.nombre).includes(buscado) ||
        normalizarTexto(c.numeroDocumento).includes(buscado)
    );
  }

  // Ordenar por nombre. localeCompare con 'es' ordena como en español:
  // "Álvarez" va con las A, sin importar mayúsculas.
  filtrados.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));

  // Cortar la página pedida:
  //   page 1 → del 0 al 19;  page 2 → del 20 al 39;  etc.
  const desde = (page - 1) * pageSize;
  const data = filtrados.slice(desde, desde + pageSize);

  // ═══ 4. DEVOLVER ═══
  // total = cuántos clientes cumplen el filtro (no solo los de esta página)
  return { data, page, pageSize, total: filtrados.length };
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
// datos (sin validar):
// {
//   "tipoDocumento": "DNI",                 // DNI o CUIT
//   "numeroDocumento": "30111222",
//   "nombre": "María Pérez",
//   "domicilio": "San Martín 123",          // opcional
//   "telefono": "381 555-1234",             // opcional
//   "email": "maria@mail.com",              // opcional
//   "cuentaCorrienteHabilitada": true,      // opcional, por defecto false
//   "limiteCreditoCentavos": 5000000        // opcional, en centavos
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

  // tipoDocumento: solo 'DNI' o 'CUIT'
  if (datos.tipoDocumento !== 'DNI' && datos.tipoDocumento !== 'CUIT') {
    detalles.push({ campo: 'tipoDocumento', mensaje: 'Tiene que ser DNI o CUIT.' });
  }

  // numeroDocumento y nombre: obligatorios. Primero chequeamos que sean
  // texto, porque si llega un número, .trim() no existe y explotaría.
  if (typeof datos.numeroDocumento !== 'string' || datos.numeroDocumento.trim() === '') {
    detalles.push({ campo: 'numeroDocumento', mensaje: 'Es obligatorio.' });
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

  // cuentaCorrienteHabilitada: si no vino, queda en false
  let cuentaCorrienteHabilitada = false;
  if (datos.cuentaCorrienteHabilitada !== undefined) {
    if (typeof datos.cuentaCorrienteHabilitada !== 'boolean') {
      detalles.push({ campo: 'cuentaCorrienteHabilitada', mensaje: 'Tiene que ser true o false.' });
    } else {
      cuentaCorrienteHabilitada = datos.cuentaCorrienteHabilitada;
    }
  }

  // limiteCreditoCentavos: opcional. Si viene, entero positivo — regla 10:
  // importes en centavos enteros, así que no se aceptan decimales.
  // Number.isInteger rechaza de una vez textos, decimales y null.
  let limiteCreditoCentavos: number | null = null;
  if (datos.limiteCreditoCentavos !== undefined && datos.limiteCreditoCentavos !== null) {
    if (!Number.isInteger(datos.limiteCreditoCentavos) || datos.limiteCreditoCentavos <= 0) {
      detalles.push({
        campo: 'limiteCreditoCentavos',
        mensaje: 'Tiene que ser un entero positivo, en centavos.',
      });
    } else {
      limiteCreditoCentavos = datos.limiteCreditoCentavos;
    }
  }

  // Si hubo algún error de campo, cortamos acá con 422 y la lista completa
  if (detalles.length > 0) {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }

  // A partir de acá sabemos que los datos son válidos
  const tipoDocumento: 'DNI' | 'CUIT' = datos.tipoDocumento;
  const numeroDocumento: string = datos.numeroDocumento.trim();
  const nombre: string = datos.nombre.trim();

  // ═══ 2. PERMISO ═══
  // Admin y vendedor pueden dar de alta clientes: no hay chequeo de rol.
  void usuario;

  // ═══ 3. REGLAS ═══

  // Sin cuenta corriente el límite de crédito no tiene sentido: queda en
  // null aunque lo hayan mandado (RF-C2, regla 7).
  if (!cuentaCorrienteHabilitada) {
    limiteCreditoCentavos = null;
  }

  // El par tipo + número de documento es único (RF-C2). Lo buscamos antes
  // de insertar para poder devolver un error claro.
  // Es 409 y no 422: el pedido está bien, pero choca con un dato que YA
  // EXISTE en la base (criterio de la sección 11.8).
  const existentes = await db
    .select({ id: clientes.id })
    .from(clientes)
    .where(
      and(
        eq(clientes.tipoDocumento, tipoDocumento),
        eq(clientes.numeroDocumento, numeroDocumento)
      )
    );
  if (existentes.length > 0) {
    throw new ApiError(
      409,
      'DOCUMENTO_DUPLICADO',
      `Ya existe un cliente con ${tipoDocumento} ${numeroDocumento}.`,
      [{ campo: 'numeroDocumento', mensaje: 'Ya existe.' }]
    );
  }

  // Guardar. La fecha la pone el servidor, en ISO 8601 UTC (sección 11.1).
  // Toca una sola tabla, así que no hace falta transacción.
  // .returning() devuelve la fila insertada, con el id que le asignó la base.
  const filas = await db
    .insert(clientes)
    .values({
      tipoDocumento,
      numeroDocumento,
      nombre,
      domicilio,
      telefono,
      email,
      cuentaCorrienteHabilitada,
      limiteCreditoCentavos,
      activo: true,
      creadoEn: new Date().toISOString(),
    })
    .returning();

  // ═══ 4. DEVOLVER ═══
  // Un cliente recién creado no tiene movimientos: su saldo es 0 (regla 7)
  return { ...filas[0], saldoCentavos: 0 };
}
