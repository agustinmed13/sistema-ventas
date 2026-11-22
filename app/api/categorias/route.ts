// /api/categorias — adaptador fino (AGENTS.md, sección 3). RF-P7.
//   GET   listado, los dos roles (el formulario de productos lo usa)
//   POST  alta, solo admin
// Acá no hay reglas: están en lib/servicios/productos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { crearCategoria, listarCategorias } from '@/lib/servicios/productos';

// GET /api/categorias?activo=todos&page=1&pageSize=20
export async function GET(request: Request) {
    try {
        // Toda ruta exige sesión (sección 11.1)
        const usuario = await obtenerUsuarioActual();

        if (!usuario) {
            throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
        }

        const parametros = new URL(request.url).searchParams;

        const resultado = await listarCategorias(usuario, {
            activo: parametros.get('activo'),
            page: parametros.get('page'),
            pageSize: parametros.get('pageSize'),
        });

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}

// POST /api/categorias — recibe { "nombre": "Herramientas" }
export async function POST(request: Request) {
    try {
        const usuario = await obtenerUsuarioActual();

        if (!usuario) {
            throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
        }

        // request.json() falla si el texto no es JSON válido (400).
        let cuerpo;
        try {
            cuerpo = await request.json();
        } catch {
            throw new ApiError(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
        }

        if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
            throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
        }

        const categoria = await crearCategoria(usuario, cuerpo);

        // 201 = "se creó algo nuevo"
        return Response.json(categoria, { status: 201 });
    } catch (error) {
        return manejarError(error);
    }
}
