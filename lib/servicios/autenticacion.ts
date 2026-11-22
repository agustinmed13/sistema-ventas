// Servicio de autenticación (RF-U1).
//
// Capa de servicios (AGENTS.md sección 3): acá viven las reglas del login.
// Las rutas de app/api/auth/ solo leen el pedido, llaman a estas funciones
// y responden.
//
// Si algo sale mal, se lanza un ApiError (sección 10.4). La ruta lo
// atrapa y lo convierte en respuesta con manejarError().

import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { usuarios } from '@/db/schema';
import { ApiError, type DetalleError } from '@/lib/errores';
// "as": lib/auth también tiene una función llamada cerrarSesion. Acá la
// importamos con otro nombre para que no choque con la de este servicio.
import { verificarContrasena, crearSesion, cerrarSesion as borrarSesionActual } from '@/lib/auth';

// Un hash bcrypt cualquiera (de una contraseña que no usa nadie). Se usa
// cuando el usuario no existe, para que bcrypt trabaje igual y la respuesta
// tarde lo mismo. Ver el paso 3 de iniciarSesion.
const HASH_DE_RELLENO = '$2b$10$yywJMjD0N8yEv9bwnydC.uzBRh/1Tp3ch6DMjgFrg.EJOiZf/UPIS';

// ─────────────────────────────────────────────────────────────
// iniciarSesion — verifica las credenciales y abre la sesión.
//
// Recibe los datos SIN VALIDAR, tal como llegaron en el pedido (por eso
// "unknown": pueden ser cualquier cosa). Validar es trabajo del servicio.
// Devuelve { id, nombre, email, rol }. Nunca el hash.
// ─────────────────────────────────────────────────────────────
// "password" es el nombre del campo en la API (consigna, sección 11.3).
export async function iniciarSesion(email: unknown, password: unknown) {
  // 1. Validar. Juntamos TODOS los errores de campo en "details", así la
  //    pantalla puede marcar los dos campos a la vez.
  const detalles: DetalleError[] = [];
  if (typeof email !== 'string' || email.trim() === '') {
    detalles.push({ campo: 'email', mensaje: 'Es obligatorio.' });
  }
  if (typeof password !== 'string' || password.trim() === '') {
    detalles.push({ campo: 'password', mensaje: 'Es obligatoria.' });
  }
  // La segunda parte del if le confirma a TypeScript que son textos
  if (detalles.length > 0 || typeof email !== 'string' || typeof password !== 'string') {
    throw new ApiError(422, 'VALIDACION', 'Hay campos con errores.', detalles);
  }

  // 2. Normalizar el email: no distingue mayúsculas, así que
  //    " Admin@Mostrador.com " y "admin@mostrador.com" son el mismo usuario.
  //    La contraseña NO se toca: ahí sí importan mayúsculas y espacios.
  const emailNormalizado = email.trim().toLowerCase();

  // 3. Buscar al usuario. Esta consulta trae el hash de la contraseña
  //    porque hay que compararlo (la otra que lo lee es cambiarContrasena,
  //    en usuarios.ts). El hash se usa acá adentro y nunca sale de esta
  //    función.
  const filas = await db.select().from(usuarios).where(eq(usuarios.email, emailNormalizado));
  const usuario = filas[0];

  // Comparamos la contraseña SIEMPRE, exista o no el usuario.
  // bcrypt es lento a propósito. Si solo lo ejecutáramos cuando el usuario
  // existe, un atacante podría medir el tiempo de respuesta y deducir qué
  // cuentas existen: "rápido = no existe, lento = existe". Con el hash de
  // relleno tarda lo mismo.
  let hash = HASH_DE_RELLENO;
  if (usuario) {
    hash = usuario.contrasenaHash;
  }
  const contrasenaCorrecta = await verificarContrasena(password, hash);

  // 4. Tres formas de fallar, UNA sola respuesta:
  //    - el usuario no existe
  //    - la contraseña no coincide
  //    - el usuario está inactivo
  //    Si cada caso tuviera su propio mensaje, alguien podría probar emails
  //    y averiguar cuáles son cuentas reales. Con el mismo 401 y el mismo
  //    mensaje no se puede distinguir nada.
  //    El inactivo es 401 y no 403: 403 sería "te reconozco pero no podés",
  //    y eso ya revelaría que la cuenta existe.
  if (!usuario || !contrasenaCorrecta || !usuario.activo) {
    throw new ApiError(401, 'CREDENCIALES_INVALIDAS', 'Email o contraseña incorrectos.');
  }

  // 5. Todo bien: abrir la sesión (guarda la fila en "sesiones" y
  //    deja la cookie en el navegador; ver lib/auth.ts).
  await crearSesion(usuario.id);

  // Armado campo por campo, para que el hash no se cuele.
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
  };
}

// ─────────────────────────────────────────────────────────────
// cerrarSesion — borra la sesión actual (la fila y la cookie).
// Si no hay sesión abierta no hace nada y no falla: cerrar dos veces
// no es un error.
// ─────────────────────────────────────────────────────────────
export async function cerrarSesion() {
  await borrarSesionActual();
}
