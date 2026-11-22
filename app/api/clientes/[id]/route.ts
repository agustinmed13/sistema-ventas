// /api/clientes/[id]
//   GET    la ficha del cliente, con sus últimas 6 facturas (RF-C3)
//   PATCH  editar el cliente o darlo de baja con "activo": false (RF-C2, RF-C7)
//
// No hay DELETE: un cliente con historial nunca se borra (regla 12).
//
// La carpeta [id] con corchetes le dice a Next.js que esa parte de la URL
// es variable: /api/clientes/12 llega acá con id = "12".
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, lee el pedido,
// llama al servicio y responde. Las reglas están en
// lib/servicios/clientes.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { obtenerCliente, actualizarCliente } from '@/lib/servicios/clientes';

// En Next.js 16, params es una promesa: hay que esperarla con await
type Contexto = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Contexto) {
  try {
    // Toda ruta exige sesión (sección 11.1)
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    const { id } = await params;
    const cliente = await obtenerCliente(usuario, id);
    return Response.json(cliente);
  } catch (error) {
    return manejarError(error);
  }
}

export async function PATCH(request: Request, { params }: Contexto) {
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
    const cliente = await actualizarCliente(usuario, id, cuerpo);

    // 200: se modificó algo que ya existía (no se creó nada nuevo)
    return Response.json(cliente);
  } catch (error) {
    return manejarError(error);
  }
}
