// GET /api/tablero — todo lo de la pantalla de inicio en una sola
// respuesta (RF-T1, RF-T2, RF-T3; consigna, sección 11.7).
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, llama al servicio
// y responde. Los cálculos están en lib/servicios/tablero.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { obtenerTablero } from '@/lib/servicios/tablero';

export async function GET() {
  try {
    // Toda ruta exige sesión (sección 11.1)
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    const tablero = await obtenerTablero(usuario);
    return Response.json(tablero);
  } catch (error) {
    return manejarError(error);
  }
}
