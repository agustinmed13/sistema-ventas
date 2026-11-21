// Todo lo relacionado con la sesión del usuario.
//
// Cómo funciona, en resumen:
//   1. Al iniciar sesión se genera un token al azar y se guarda una fila en
//      la tabla "sesiones" (token, usuario, vencimiento).
//   2. El token viaja al navegador en una cookie llamada "sesion".
//   3. En cada pedido, el navegador manda la cookie solo. El servidor busca
//      ese token en "sesiones" para saber quién es.
//
// ACÁ SE VERIFICA LA SESIÓN: en obtenerUsuarioActual(), más abajo.
// Cada ruta de la API la llama explícitamente al empezar.

import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { db } from '@/db/index';
import { usuarios, sesiones } from '@/db/schema';

const NOMBRE_COOKIE = 'sesion';

// 7 días expresados en milisegundos (días × horas × minutos × segundos × ms)
const DURACION_SESION_MS = 7 * 24 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────
// Compara la contraseña que escribió el usuario con el hash guardado.
// Devuelve true o false.
// ─────────────────────────────────────────────────────────────
export async function verificarContrasena(plano: string, hash: string) {
  // bcrypt no "desencripta" el hash (no se puede). Lo que hace es aplicar
  // el mismo cálculo a la contraseña escrita y ver si da el mismo resultado.
  return await bcrypt.compare(plano, hash);
}

// ─────────────────────────────────────────────────────────────
// Abre una sesión nueva para el usuario: guarda la fila y setea la cookie.
// Solo se puede llamar desde una ruta de la API (Route Handler), porque
// es el único lugar donde Next.js deja escribir cookies.
// ─────────────────────────────────────────────────────────────
export async function crearSesion(usuarioId: number) {
  // 32 bytes al azar, escritos como texto hexadecimal (64 caracteres).
  // Es imposible de adivinar, y por eso alcanza como "llave" de la sesión.
  const token = randomBytes(32).toString('hex');

  const ahora = new Date();
  const expiraEn = new Date(ahora.getTime() + DURACION_SESION_MS);

  await db.insert(sesiones).values({
    id: token,
    usuarioId: usuarioId,
    expiraEn: expiraEn.toISOString(),
    creadaEn: ahora.toISOString(),
  });

  const cookieStore = await cookies();
  cookieStore.set(NOMBRE_COOKIE, token, {
    // El JavaScript del navegador no puede leer la cookie.
    // Si alguien logra meter un script en la página, no puede robar el token.
    httpOnly: true,
    // El navegador no manda la cookie en pedidos que vienen de otros sitios
    // (salvo cuando el usuario hace clic en un link hacia el nuestro).
    sameSite: 'lax',
    // La cookie vale para todas las rutas del sitio.
    path: '/',
    // Solo viaja por HTTPS. En desarrollo usamos http://localhost, así que
    // la activamos únicamente en producción (Vercel).
    secure: process.env.NODE_ENV === 'production',
    // El navegador la borra sola cuando vence, igual que la fila.
    expires: expiraEn,
  });

  return token;
}

// ─────────────────────────────────────────────────────────────
// Devuelve el usuario que hizo el pedido, o null si no hay sesión válida.
// NUNCA devuelve el hash de la contraseña.
// ─────────────────────────────────────────────────────────────
export async function obtenerUsuarioActual() {
  // 1. Leer la cookie. Si no vino, no hay sesión.
  const cookieStore = await cookies();
  const cookie = cookieStore.get(NOMBRE_COOKIE);
  if (!cookie) return null;

  // 2. Buscar la sesión por su token. Si no existe (por ejemplo, porque
  //    se cerró), no hay sesión.
  const filasSesion = await db
    .select()
    .from(sesiones)
    .where(eq(sesiones.id, cookie.value));
  const sesion = filasSesion[0];
  if (!sesion) return null;

  // 3. Verificar que no esté vencida. No alcanza con que la cookie venza
  //    en el navegador: alguien podría reenviar el token a mano.
  if (new Date(sesion.expiraEn) < new Date()) return null;

  // 4. Buscar al usuario. Se eligen las columnas una por una a propósito:
  //    así el hash de la contraseña nunca sale de esta función.
  const filasUsuario = await db
    .select({
      id: usuarios.id,
      nombre: usuarios.nombre,
      acceso: usuarios.acceso,
      perfil: usuarios.perfil,
      activo: usuarios.activo,
    })
    .from(usuarios)
    .where(eq(usuarios.id, sesion.usuarioId));
  const usuario = filasUsuario[0];

  // 5. Si el usuario fue desactivado mientras tenía la sesión abierta,
  //    su próximo pedido falla acá.
  if (!usuario || !usuario.activo) return null;

  return usuario;
}

// ─────────────────────────────────────────────────────────────
// Cierra la sesión actual: borra la fila y la cookie.
// Igual que crearSesion, solo se puede llamar desde una ruta de la API.
// ─────────────────────────────────────────────────────────────
export async function cerrarSesion() {
  const cookieStore = await cookies();
  const cookie = cookieStore.get(NOMBRE_COOKIE);

  // Borrar la fila es lo importante: aunque alguien se haya guardado el
  // token, ya no sirve porque no está en la tabla.
  if (cookie) {
    await db.delete(sesiones).where(eq(sesiones.id, cookie.value));
  }

  // Le dice al navegador que tire la cookie.
  cookieStore.delete(NOMBRE_COOKIE);
}
