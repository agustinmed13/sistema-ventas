// GET /api/movimientos-stock — movimientos de todos los productos (RF-P6).
// Los dos roles. Filtros: productoId, tipo, desde, hasta (AAAA-MM-DD, días
// de Argentina) y paginación. Ordenados del más nuevo al más viejo.
//
// Adaptador fino (AGENTS.md sección 3): las reglas están en
// listarMovimientos(), en lib/servicios/productos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { listarMovimientos } from '@/lib/servicios/productos';

export async function GET(request: Request) {
    try {
        // Toda ruta exige sesión (sección 11.1)
        const usuario = await obtenerUsuarioActual();
        if (!usuario) {
            throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
        }

        // "|| null": un parámetro vacío (?tipo=) cuenta como si no hubiera venido
        const parametros = new URL(request.url).searchParams;
        const resultado = await listarMovimientos(usuario, {
            productoId: parametros.get('productoId') || null,
            tipo: parametros.get('tipo') || null,
            desde: parametros.get('desde') || null,
            hasta: parametros.get('hasta') || null,
            page: parametros.get('page') || null,
            pageSize: parametros.get('pageSize') || null,
        });

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}
