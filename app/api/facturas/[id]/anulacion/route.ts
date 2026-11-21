// POST /api/facturas/[id]/anulacion — anular una factura (RF-V9)
// Solo admin. Recibe: { "motivo": "Error de carga" }
//
// Adaptador fino (AGENTS.md sección 3). El control de rol y las reglas
// de la anulación están en anularFactura(), en lib/servicios/facturas.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { anularFactura } from '@/lib/servicios/facturas';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    // Leer el cuerpo. request.json() falla si el texto no es JSON válido.
    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      throw new ApiError(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
    }
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
    }

    const { id } = await params;
    const factura = await anularFactura(usuario, id, cuerpo);

    // 200 con la factura ya anulada, igual que el detalle
    return Response.json(factura);
  } catch (error) {
    return manejarError(error);
  }
}
