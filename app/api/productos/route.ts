// /api/productos — adaptador fino (AGENTS.md, sección 3).
//   GET   listado del catálogo, los dos roles (RF-P1)
//   POST  alta de producto, solo admin (RF-P2)
// Acá no hay reglas: están en lib/servicios/productos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { crearProducto, listarProductos } from '@/lib/servicios/productos';

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
            bajoMinimo: parametros.get('bajoMinimo'),
            activo: parametros.get('activo'),
            page: parametros.get('page'),
            pageSize: parametros.get('pageSize'),
        });

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}

// POST /api/productos — alta de producto (RF-P2). Solo admin.
// El formato del cuerpo y todas las reglas están en crearProducto().
export async function POST(request: Request) {
    try {
        const usuario = await obtenerUsuarioActual();

        if (!usuario) {
            throw new ApiError(
                401,
                'NO_AUTENTICADO',
                'Tenés que iniciar sesión.'
            );
        }

        // request.json() falla si el texto no es JSON válido (400).
        let cuerpo;
        try {
            cuerpo = await request.json();
        } catch {
            throw new ApiError(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
        }

        // Un JSON válido también puede ser null, un número o una lista:
        // necesitamos un objeto para leer sus campos.
        if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
            throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
        }

        const producto = await crearProducto(usuario, cuerpo);

        // 201 = "se creó algo nuevo"
        return Response.json(producto, { status: 201 });
    } catch (error) {
        return manejarError(error);
    }
}
