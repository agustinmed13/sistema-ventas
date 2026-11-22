// Servicio de usuarios (RF-U4 Gestión, RF-U5 Contraseñas).
//
// Capa de servicios (AGENTS.md sección 3): acá viven las reglas. Las rutas
// de app/api/usuarios/ y app/api/auth/password/ solo leen el pedido, llaman
// a estas funciones y responden.
//
// Nombres de campo exactos de la consigna (requerimientos.md, sección 11.3):
//   usuario:   { id, nombre, email, rol, activo }   ← nunca el hash
//   alta:      { nombre, email, rol, password }     ← password temporal
//   cambio:    { actual, nueva }                    ← PUT /api/auth/password
//   reset:     { passwordTemporal }                 ← se muestra una sola vez

import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { and, count, eq, ne, or, sql, type SQL } from 'drizzle-orm';
import { db } from '@/db/index';
import { usuarios } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';
import { verificarContrasena } from '@/lib/auth';

// El usuario que hizo el pedido (lo que devuelve obtenerUsuarioActual).
type UsuarioSesion = {
    id: number;
    nombre: string;
    rol: 'admin' | 'vendedor';
};

// Mínimo de caracteres de una contraseña (consigna 11.3: "mínimo 8").
const LARGO_MINIMO_PASSWORD = 8;

// Costo de bcrypt: repite el cálculo 2^10 veces. Es el mismo que usa el
// seed, así todas las contraseñas se guardan igual.
const COSTO_BCRYPT = 10;

// ─────────────────────────────────────────────────────────────
// Ayudas
// ─────────────────────────────────────────────────────────────

// Arma la respuesta campo por campo, para que el hash NUNCA se cuele
// (consigna 11.3: "sin el hash de contraseña").
function aUsuarioApi(fila: typeof usuarios.$inferSelect) {
    return {
        id: fila.id,
        nombre: fila.nombre,
        email: fila.email,
        rol: fila.rol,
        activo: fila.activo,
    };
}

// RF-U4: gestionar usuarios es solo del administrador (sección 3 de la
// consigna). El vendedor recibe 403 aunque llame directo a la ruta
// (sección 10.8, punto 2).
function exigirAdmin(usuario: UsuarioSesion) {
    if (usuario.rol !== 'admin') {
        throw new ApiError(403, 'SIN_PERMISO', 'Solo un administrador puede gestionar usuarios.');
    }
}

function lanzarErroresValidacion(detalles: DetalleError[]) {
    if (detalles.length > 0) {
        throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
    }
}

// El email se guarda en minúsculas y sin espacios: el login lo busca así
// (ver iniciarSesion en autenticacion.ts), y "Ana@X.com" y "ana@x.com"
// tienen que ser la misma cuenta.
function normalizarEmail(email: string) {
    return email.trim().toLowerCase();
}

// Validación simple de email: algo@algo.algo, sin espacios.
function emailValido(email: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Un id de la URL ("12") → número. Si no es válido, ese usuario no existe.
function leerId(idTexto: string) {
    const id = Number(idTexto);
    if (!Number.isInteger(id) || id <= 0) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese usuario.');
    }
    return id;
}

// El email es único (RF-U4). idPropio deja afuera al usuario que se está
// editando: guardarlo con su mismo email no es un duplicado.
// 409 porque choca con un dato que YA EXISTE (criterio de la sección 11.8).
async function verificarEmailLibre(email: string, idPropio: number | null) {
    const condiciones: SQL[] = [eq(usuarios.email, email)];
    if (idPropio !== null) {
        condiciones.push(ne(usuarios.id, idPropio));
    }

    const [repetido] = await db
        .select({ id: usuarios.id })
        .from(usuarios)
        .where(and(...condiciones));

    if (repetido) {
        throw new ApiError(409, 'EMAIL_DUPLICADO', `Ya existe un usuario con el email ${email}.`, [
            { campo: 'email', mensaje: 'Ya existe.' },
        ]);
    }
}

// ═════════════════════════════════════════════════════════════
// listarUsuarios — GET /api/usuarios (RF-U4). Solo admin.
//
// Filtros (sección 11.3): q (nombre o email), activo, paginación.
// Sin "activo" se ven TODOS: el admin necesita ver a los desactivados
// para poder reactivarlos.
// ═════════════════════════════════════════════════════════════
export async function listarUsuarios(
    usuario: UsuarioSesion,
    filtros: { q: string | null; activo: string | null; page: string | null; pageSize: string | null }
) {
    // ═══ 1. VALIDAR ═══
    const detalles: DetalleError[] = [];
    const condiciones: SQL[] = [];

    // Búsqueda por nombre o email, sin distinguir mayúsculas.
    const busqueda = filtros.q?.trim().toLowerCase() ?? '';
    if (busqueda !== '') {
        condiciones.push(
            or(
                sql`instr(lower(${usuarios.nombre}), ${busqueda}) > 0`,
                sql`instr(lower(${usuarios.email}), ${busqueda}) > 0`
            )!
        );
    }

    if (filtros.activo !== null) {
        if (filtros.activo !== 'true' && filtros.activo !== 'false') {
            detalles.push({ campo: 'activo', mensaje: 'Tiene que ser true o false.' });
        } else {
            condiciones.push(eq(usuarios.activo, filtros.activo === 'true'));
        }
    }

    // Paginación (sección 11.1): page desde 1; pageSize por defecto 20, máximo 100.
    let page = 1;
    if (filtros.page !== null) {
        page = Number(filtros.page);
        if (!Number.isInteger(page) || page < 1) {
            detalles.push({ campo: 'page', mensaje: 'La página tiene que ser un entero desde 1.' });
        }
    }

    let pageSize = 20;
    if (filtros.pageSize !== null) {
        pageSize = Number(filtros.pageSize);
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
            detalles.push({
                campo: 'pageSize',
                mensaje: 'El tamaño de página tiene que ser un entero entre 1 y 100.',
            });
        }
    }

    lanzarErroresValidacion(detalles);

    // ═══ 2. PERMISO ═══
    exigirAdmin(usuario);

    // ═══ 3. CONSULTAR ═══
    const [conteo] = await db
        .select({ total: count() })
        .from(usuarios)
        .where(and(...condiciones));

    const filas = await db
        .select()
        .from(usuarios)
        .where(and(...condiciones))
        .orderBy(usuarios.nombre)
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    // ═══ 4. DEVOLVER ═══
    return { data: filas.map(aUsuarioApi), page, pageSize, total: conteo.total };
}

// ═════════════════════════════════════════════════════════════
// obtenerUsuario — un usuario, para la pantalla de edición (RF-U4).
// Solo admin. La consigna no define GET /api/usuarios/{id}: esta función
// la usa directo la página /usuarios/[id] (Server Component, consigna 10.6).
// ═════════════════════════════════════════════════════════════
export async function obtenerUsuario(usuario: UsuarioSesion, idTexto: string) {
    const id = leerId(idTexto);
    exigirAdmin(usuario);

    const [fila] = await db.select().from(usuarios).where(eq(usuarios.id, id));
    if (!fila) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese usuario.');
    }

    return aUsuarioApi(fila);
}

// ═════════════════════════════════════════════════════════════
// crearUsuario — POST /api/usuarios (RF-U4). Solo admin.
//
// datos (sin validar):
// { "nombre": "Laura Méndez", "email": "laura@x.com",
//   "rol": "vendedor", "password": "temporal123" }
// ═════════════════════════════════════════════════════════════
export async function crearUsuario(usuario: UsuarioSesion, datos: any) {
    // ═══ 1. VALIDAR ═══
    const detalles: DetalleError[] = [];

    if (typeof datos.nombre !== 'string' || datos.nombre.trim() === '') {
        detalles.push({ campo: 'nombre', mensaje: 'Es obligatorio.' });
    }
    if (typeof datos.email !== 'string' || !emailValido(normalizarEmail(datos.email))) {
        detalles.push({ campo: 'email', mensaje: 'Tiene que ser un email válido.' });
    }
    if (datos.rol !== 'admin' && datos.rol !== 'vendedor') {
        detalles.push({ campo: 'rol', mensaje: 'Tiene que ser admin o vendedor.' });
    }
    // La contraseña NO se recorta: los espacios cuentan.
    if (typeof datos.password !== 'string' || datos.password.length < LARGO_MINIMO_PASSWORD) {
        detalles.push({
            campo: 'password',
            mensaje: `Tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`,
        });
    }

    lanzarErroresValidacion(detalles);

    const nombre: string = datos.nombre.trim();
    const email = normalizarEmail(datos.email);
    const rol: 'admin' | 'vendedor' = datos.rol;

    // ═══ 2. PERMISO ═══
    exigirAdmin(usuario);

    // ═══ 3. REGLAS ═══
    await verificarEmailLibre(email, null);

    // La contraseña nunca se guarda: se guarda su hash.
    const contrasenaHash = await bcrypt.hash(datos.password, COSTO_BCRYPT);

    // Una sola tabla: no hace falta transacción.
    const [nuevo] = await db
        .insert(usuarios)
        .values({ nombre, email, rol, contrasenaHash, activo: true, creadoEn: new Date().toISOString() })
        .returning();

    // ═══ 4. DEVOLVER ═══
    return aUsuarioApi(nuevo);
}

// ═════════════════════════════════════════════════════════════
// modificarUsuario — PATCH /api/usuarios/{id} (RF-U4). Solo admin.
//
// datos (sin validar): cualquiera de { nombre, email, rol, activo }.
// La contraseña NO se cambia acá: para eso está reset-password.
// ═════════════════════════════════════════════════════════════
export async function modificarUsuario(usuario: UsuarioSesion, idTexto: string, datos: any) {
    // ═══ 1. VALIDAR ═══
    const id = leerId(idTexto);
    const detalles: DetalleError[] = [];

    // Solo los campos que vinieron, ya con el nombre de la columna.
    const cambios: { nombre?: string; email?: string; rol?: 'admin' | 'vendedor'; activo?: boolean } = {};

    if (datos.nombre !== undefined) {
        if (typeof datos.nombre !== 'string' || datos.nombre.trim() === '') {
            detalles.push({ campo: 'nombre', mensaje: 'No puede quedar vacío.' });
        } else {
            cambios.nombre = datos.nombre.trim();
        }
    }

    if (datos.email !== undefined) {
        if (typeof datos.email !== 'string' || !emailValido(normalizarEmail(datos.email))) {
            detalles.push({ campo: 'email', mensaje: 'Tiene que ser un email válido.' });
        } else {
            cambios.email = normalizarEmail(datos.email);
        }
    }

    if (datos.rol !== undefined) {
        if (datos.rol !== 'admin' && datos.rol !== 'vendedor') {
            detalles.push({ campo: 'rol', mensaje: 'Tiene que ser admin o vendedor.' });
        } else {
            cambios.rol = datos.rol;
        }
    }

    if (datos.activo !== undefined) {
        if (typeof datos.activo !== 'boolean') {
            detalles.push({ campo: 'activo', mensaje: 'Tiene que ser true o false.' });
        } else {
            cambios.activo = datos.activo;
        }
    }

    lanzarErroresValidacion(detalles);

    if (Object.keys(cambios).length === 0) {
        throw new ApiError(422, 'VALIDACION', 'No hay campos para modificar.');
    }

    // ═══ 2. PERMISO ═══
    exigirAdmin(usuario);

    // ═══ 3. REGLAS ═══

    // Un admin no puede desactivarse ni quitarse el rol de admin
    // (consigna 11.3). Si pudiera, el sistema podría quedarse sin ningún
    // administrador y nadie podría volver a gestionar usuarios.
    if (id === usuario.id && (cambios.activo === false || cambios.rol === 'vendedor')) {
        throw new ApiError(
            422,
            'OPERACION_SOBRE_SI_MISMO',
            'No podés desactivarte ni quitarte el rol de administrador.'
        );
    }

    const [actual] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, id));
    if (!actual) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese usuario.');
    }

    if (cambios.email !== undefined) {
        await verificarEmailLibre(cambios.email, id);
    }

    // RF-U4: "un usuario desactivado no puede entrar". No hace falta nada
    // más acá: el login rechaza a los inactivos, y obtenerUsuarioActual()
    // (lib/auth.ts) también, así que si tenía la sesión abierta queda
    // afuera en su próximo pedido.
    const [modificado] = await db.update(usuarios).set(cambios).where(eq(usuarios.id, id)).returning();

    // ═══ 4. DEVOLVER ═══
    return aUsuarioApi(modificado);
}

// ═════════════════════════════════════════════════════════════
// restablecerContrasena — POST /api/usuarios/{id}/reset-password (RF-U5).
// Solo admin. Genera una contraseña temporal nueva y la devuelve UNA vez:
// después solo queda su hash y nadie puede volver a verla.
// ═════════════════════════════════════════════════════════════
export async function restablecerContrasena(usuario: UsuarioSesion, idTexto: string) {
    // ═══ 1. VALIDAR ═══
    const id = leerId(idTexto);

    // ═══ 2. PERMISO ═══
    exigirAdmin(usuario);

    // ═══ 3. REGLAS ═══
    const [actual] = await db.select({ id: usuarios.id }).from(usuarios).where(eq(usuarios.id, id));
    if (!actual) {
        throw new ApiError(404, 'NO_ENCONTRADO', 'No existe ese usuario.');
    }

    // 6 bytes al azar → 12 caracteres hexadecimales (ej. "3f9a0c71b2de").
    // randomBytes usa el generador seguro del sistema, no Math.random().
    const passwordTemporal = randomBytes(6).toString('hex');
    const contrasenaHash = await bcrypt.hash(passwordTemporal, COSTO_BCRYPT);

    await db.update(usuarios).set({ contrasenaHash }).where(eq(usuarios.id, id));

    // ═══ 4. DEVOLVER ═══ (sección 11.3: 200 con { passwordTemporal })
    return { passwordTemporal };
}

// ═════════════════════════════════════════════════════════════
// cambiarContrasena — PUT /api/auth/password (RF-U5). Los dos roles:
// cada usuario cambia LA SUYA, por eso no recibe un id.
//
// datos (sin validar): { "actual": "...", "nueva": "..." }
// ═════════════════════════════════════════════════════════════
export async function cambiarContrasena(usuario: UsuarioSesion, datos: any) {
    // ═══ 1. VALIDAR ═══
    const detalles: DetalleError[] = [];

    if (typeof datos.actual !== 'string' || datos.actual === '') {
        detalles.push({ campo: 'actual', mensaje: 'Es obligatoria.' });
    }
    if (typeof datos.nueva !== 'string' || datos.nueva.length < LARGO_MINIMO_PASSWORD) {
        detalles.push({
            campo: 'nueva',
            mensaje: `Tiene que tener al menos ${LARGO_MINIMO_PASSWORD} caracteres.`,
        });
    }

    lanzarErroresValidacion(detalles);

    // ═══ 2. PERMISO ═══
    // Cualquier usuario con sesión puede cambiar la suya: no hay chequeo de rol.

    // ═══ 3. REGLAS ═══
    // Se pide la contraseña actual para que, si alguien encuentra la sesión
    // abierta en una computadora, no pueda cambiarla y quedarse con la cuenta.
    const [fila] = await db
        .select({ contrasenaHash: usuarios.contrasenaHash })
        .from(usuarios)
        .where(eq(usuarios.id, usuario.id));

    const correcta = fila ? await verificarContrasena(datos.actual, fila.contrasenaHash) : false;

    if (!correcta) {
        // 422 y no 401: la sesión es válida; lo que falla es un dato del pedido.
        throw new ApiError(422, 'CONTRASENA_ACTUAL_INCORRECTA', 'La contraseña actual no es correcta.', [
            { campo: 'actual', mensaje: 'No es correcta.' },
        ]);
    }

    const contrasenaHash = await bcrypt.hash(datos.nueva, COSTO_BCRYPT);
    await db.update(usuarios).set({ contrasenaHash }).where(eq(usuarios.id, usuario.id));

    // La ruta responde 204 (sin cuerpo): no hay nada que devolver.
}
