// GET /api/productos — adaptador fino (AGENTS.md, sección 3).
// Los dos roles pueden consultar el catálogo (RF-P1).

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { listarProductos } from '@/lib/servicios/productos';

export async function GET(request: Request) {
    try {
        // Toda ruta exige sesión (sección 11.1).
        const usuario = await obtenerUsuarioActual();

        if (!usuario) {
            throw new ApiError(
                401,
                'NO_AUTENTICADO',
                'Tenés que iniciar sesión.'
            );
        }

        // La ruta solo lee parámetros y delega las reglas al servicio.
        const parametros = new URL(request.url).searchParams;

        const resultado = await listarProductos(usuario, {
            q: parametros.get('q'),
            categoriaId: parametros.get('categoriaId'),
            activo: parametros.get('activo'),
            page: parametros.get('page'),
            pageSize: parametros.get('pageSize'),
        });

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}
