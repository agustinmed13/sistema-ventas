// POST /api/clientes/[id]/pagos — registrar un pago (RF-C5)
//
// La carpeta [id] con corchetes le dice a Next.js que esa parte de la URL
// es variable: /api/clientes/12/pagos llega acá con id = "12".
//
// Recibe: { "importe": 500000, "medio": "transferencia", "observacion": "..." }
// Responde 201 con el recibo y el saldo nuevo del cliente.
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, lee el pedido,
// llama al servicio y responde. Las reglas (regla 8, transacción,
// número de recibo) están en lib/servicios/pagos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { registrarPago } from '@/lib/servicios/pagos';

export async function POST(
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
    const recibo = await registrarPago(usuario, id, cuerpo);

    // 201 = "se creó algo nuevo" (el recibo)
    return Response.json(recibo, { status: 201 });
  } catch (error) {
    return manejarError(error);
  }
}
