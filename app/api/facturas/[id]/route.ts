// GET /api/facturas/[id] — el comprobante completo (RF-V7)
//
// La carpeta se llama [id] con corchetes: eso le dice a Next.js que esa
// parte de la URL es variable. /api/facturas/51 llega acá con id = "51".
//
// Adaptador fino (AGENTS.md sección 3). Las reglas están en
// lib/servicios/facturas.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { obtenerFactura } from '@/lib/servicios/facturas';

export async function GET(
  request: Request,
  // En Next.js 16, params es una promesa: hay que esperarla con await
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    const { id } = await params;
    const factura = await obtenerFactura(usuario, id);
    return Response.json(factura);
  } catch (error) {
    return manejarError(error);
  }
}
