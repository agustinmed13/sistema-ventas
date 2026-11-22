// GET /api/pagos/[id] — un recibo, para reimprimirlo (RF-C5)
//
// Devuelve el mismo objeto que POST /api/clientes/[id]/pagos.
//
// La carpeta [id] con corchetes le dice a Next.js que esa parte de la URL
// es variable: /api/pagos/7 llega acá con id = "7".
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, llama al servicio
// y responde. La lógica está en obtenerPago(), en lib/servicios/pagos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { obtenerPago } from '@/lib/servicios/pagos';

export async function GET(
  request: Request,
  // En Next.js 16, params es una promesa: hay que esperarla con await
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Toda ruta exige sesión (sección 11.1)
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    const { id } = await params;
    const recibo = await obtenerPago(usuario, id);
    return Response.json(recibo);
  } catch (error) {
    return manejarError(error);
  }
}
