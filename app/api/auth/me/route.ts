// GET /api/auth/me — el usuario que tiene la sesión abierta
// Responde 200: { id, nombre, email, rol }
// Sin sesión: 401 NO_AUTENTICADO
//
// Exigir sesión es trabajo de la ruta (AGENTS.md sección 3).
// ACÁ se ve dónde se verifica: obtenerUsuarioActual() en lib/auth.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';

export async function GET() {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    // Campo por campo: "activo" no hace falta mandarlo
    return Response.json({
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
    });
  } catch (error) {
    return manejarError(error);
  }
}
