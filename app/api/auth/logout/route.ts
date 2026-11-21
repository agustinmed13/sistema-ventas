// POST /api/auth/logout — cerrar sesión
// Responde 204, sin cuerpo.
//
// Adaptador fino (AGENTS.md sección 3): llama al servicio y responde.

import { manejarError } from '@/lib/errores';
import { cerrarSesion } from '@/lib/servicios/autenticacion';

export async function POST() {
  try {
    // Si no hay sesión abierta, no falla: cerrar dos veces da 204 las dos.
    await cerrarSesion();

    // 204 = "salió bien y no hay nada que devolver". Va sin cuerpo.
    return new Response(null, { status: 204 });
  } catch (error) {
    return manejarError(error);
  }
}
