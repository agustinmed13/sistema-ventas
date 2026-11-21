// Rutas de la sesión:
//   POST   /api/sesion   iniciar sesión
//   GET    /api/sesion   quién soy (usuario actual)
//   DELETE /api/sesion   cerrar sesión
//
// En Next.js, cada función exportada con el nombre de un método HTTP
// (POST, GET, DELETE...) atiende los pedidos de ese método a esta URL.

import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { usuarios } from '@/db/schema';
import {
  verificarContrasena,
  crearSesion,
  obtenerUsuarioActual,
  cerrarSesion,
} from '@/lib/auth';
import {
  errorSolicitudInvalida,
  errorNoAutorizado,
  errorValidacion,
  errorInterno,
} from '@/lib/errores';

// El mismo mensaje para los tres casos de fallo del login (ver POST).
const MENSAJE_CREDENCIALES = 'Usuario o contraseña incorrectos.';

// Un hash bcrypt cualquiera (de una contraseña que no usa nadie). Se usa
// cuando el usuario no existe, para que bcrypt trabaje igual y la respuesta
// tarde lo mismo. Ver el paso 4 del POST.
const HASH_DE_RELLENO = '$2b$10$yywJMjD0N8yEv9bwnydC.uzBRh/1Tp3ch6DMjgFrg.EJOiZf/UPIS';

// ─────────────────────────────────────────────────────────────
// POST /api/sesion — iniciar sesión
// Recibe: { "acceso": "admin", "contrasena": "..." }
// ─────────────────────────────────────────────────────────────
export async function POST(request: Request) {
  try {
    // 1. Leer el cuerpo. request.json() tira un error si el texto no es
    //    JSON válido; lo atrapamos para devolver 400 y no 500.
    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      return errorSolicitudInvalida('El cuerpo no es JSON válido.');
    }

    // Un JSON válido también puede ser null, un número o un texto suelto.
    // Necesitamos un objeto para poder leer cuerpo.acceso.
    if (typeof cuerpo !== 'object' || cuerpo === null) {
      return errorSolicitudInvalida('Se esperaba un objeto JSON.');
    }

    // 2. Validar los campos. Chequeamos que sean texto antes de usar .trim(),
    //    porque si llega un número, .trim() no existe y explotaría.
    if (typeof cuerpo.acceso !== 'string' || cuerpo.acceso.trim() === '') {
      return errorValidacion('El acceso es obligatorio.', { campo: 'acceso' });
    }
    if (typeof cuerpo.contrasena !== 'string' || cuerpo.contrasena.trim() === '') {
      return errorValidacion('La contraseña es obligatoria.', { campo: 'contrasena' });
    }

    // 3. Normalizar el acceso: el acceso no distingue mayúsculas, así que
    //    " Admin " y "admin" son el mismo usuario. Los accesos se guardan en
    //    minúsculas en la base.
    //    La contraseña NO se toca: ahí sí importan mayúsculas y espacios.
    const acceso = cuerpo.acceso.trim().toLowerCase();

    // 4. Buscar al usuario. Esta es la ÚNICA consulta del sistema que trae
    //    el hash de la contraseña, porque hay que compararlo. El hash se
    //    usa acá adentro y nunca se manda en la respuesta.
    const filas = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.acceso, acceso));
    const usuario = filas[0];

    // Comparamos la contraseña SIEMPRE, exista o no el usuario.
    // bcrypt es lento a propósito (unos milisegundos). Si solo lo
    // ejecutáramos cuando el usuario existe, un atacante podría medir el
    // tiempo de respuesta y deducir qué usuarios existen: "rápido = no
    // existe, lento = existe". Con el hash de relleno tarda lo mismo.
    let hash = HASH_DE_RELLENO;
    if (usuario) {
      hash = usuario.contrasenaHash;
    }
    const contrasenaCorrecta = await verificarContrasena(cuerpo.contrasena, hash);

    // 5. Tres formas de fallar, UNA sola respuesta:
    //    - el usuario no existe
    //    - la contraseña no coincide
    //    - el usuario está inactivo
    //    Si cada caso tuviera su propio mensaje ("ese usuario no existe",
    //    "usuario desactivado"), alguien podría probar nombres y averiguar
    //    cuáles son cuentas reales. Con el mismo 401 y el mismo mensaje no
    //    se puede distinguir nada.
    //    El inactivo es 401 y no 403: 403 significaría "te reconozco pero no
    //    podés", y eso ya revelaría que la cuenta existe.
    if (!usuario || !contrasenaCorrecta || !usuario.activo) {
      return errorNoAutorizado(MENSAJE_CREDENCIALES);
    }

    // 6. Todo bien: abrir la sesión (guarda la fila y setea la cookie).
    await crearSesion(usuario.id);

    // Armamos la respuesta campo por campo, para que el hash no se cuele.
    return Response.json({
      id: usuario.id,
      nombre: usuario.nombre,
      acceso: usuario.acceso,
      perfil: usuario.perfil,
    });
  } catch (error) {
    return errorInterno(error);
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/sesion — devuelve el usuario que tiene la sesión abierta
// ─────────────────────────────────────────────────────────────
export async function GET() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) return errorNoAutorizado();

    return Response.json({
      id: usuario.id,
      nombre: usuario.nombre,
      acceso: usuario.acceso,
      perfil: usuario.perfil,
    });
  } catch (error) {
    return errorInterno(error);
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/sesion — cerrar sesión
// ─────────────────────────────────────────────────────────────
export async function DELETE() {
  try {
    // Si no hay sesión, cerrarSesion() no encuentra cookie, no borra
    // ninguna fila y no falla. Por eso cerrar dos veces no da error.
    await cerrarSesion();

    // 204 = "salió bien y no hay nada que devolver". Va sin cuerpo.
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorInterno(error);
  }
}
