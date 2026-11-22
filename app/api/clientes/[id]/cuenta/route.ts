// GET /api/clientes/[id]/cuenta?desde=AAAA-MM-DD&hasta=AAAA-MM-DD
// La cuenta corriente del cliente (RF-C4): movimientos en orden
// cronológico con el saldo acumulado en cada renglón.
//
// La carpeta [id] con corchetes le dice a Next.js que esa parte de la URL
// es variable: /api/clientes/12/cuenta llega acá con id = "12".
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, lee los
// parámetros, llama al servicio y responde. Las reglas están en
// obtenerCuentaCorriente(), en lib/servicios/clientes.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { obtenerCuentaCorriente } from '@/lib/servicios/clientes';

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

    // "|| null": un parámetro vacío (?desde=) cuenta como si no hubiera
    // venido. Validarlos es trabajo del servicio.
    const parametros = new URL(request.url).searchParams;
    const { id } = await params;
    const cuenta = await obtenerCuentaCorriente(usuario, id, {
      desde: parametros.get('desde') || null,
      hasta: parametros.get('hasta') || null,
    });

    return Response.json(cuenta);
  } catch (error) {
    return manejarError(error);
  }
}
