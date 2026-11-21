// /api/facturas
//   POST  emitir una factura (RF-V1 a RF-V6)
//   GET   listado con filtros y paginación (RF-V8)
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, lee el pedido,
// llama al servicio y responde. Las reglas están en
// lib/servicios/facturas.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { crearFactura, listarFacturas } from '@/lib/servicios/facturas';

export async function POST(request: Request) {
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

    const factura = await crearFactura(usuario, cuerpo);

    // 201 = "se creó algo nuevo"
    return Response.json(factura, { status: 201 });
  } catch (error) {
    return manejarError(error);
  }
}

export async function GET(request: Request) {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    // searchParams = lo que viene después del "?" en la URL.
    // "|| null" hace que un parámetro vacío (?formaPago=) cuente como
    // si no hubiera venido. Validarlos es trabajo del servicio.
    const parametros = new URL(request.url).searchParams;
    const resultado = await listarFacturas(usuario, {
      desde: parametros.get('desde') || null,
      hasta: parametros.get('hasta') || null,
      clienteId: parametros.get('clienteId') || null,
      formaPago: parametros.get('formaPago') || null,
      usuarioId: parametros.get('usuarioId') || null,
      numero: parametros.get('numero') || null,
      estado: parametros.get('estado') || null,
      page: parametros.get('page') || null,
      pageSize: parametros.get('pageSize') || null,
    });

    return Response.json(resultado);
  } catch (error) {
    return manejarError(error);
  }
}
