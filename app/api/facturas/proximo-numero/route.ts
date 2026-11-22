// GET /api/facturas/proximo-numero — RF-V4
//
// Devuelve qué número saldría si se facturara ahora, para mostrarlo en la
// pantalla de nueva venta antes de confirmar.
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, llama al servicio
// y responde. La regla está en lib/servicios/facturas.ts.
//
// Esta carpeta se llama "proximo-numero" y convive con "[id]". Next resuelve
// primero los segmentos fijos, así que /api/facturas/proximo-numero entra
// acá y no en /api/facturas/[id] buscando una factura con id
// "proximo-numero" (consigna, sección 11.9).

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { proximoNumero } from '@/lib/servicios/facturas';

export async function GET() {
  try {
    // Toda ruta exige sesión salvo el login (sección 11.1)
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    const resultado = await proximoNumero();

    return Response.json(resultado);
  } catch (error) {
    return manejarError(error);
  }
}
