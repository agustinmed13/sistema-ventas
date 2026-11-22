// /api/usuarios — adaptador fino (AGENTS.md, sección 3). RF-U4. Solo admin.
//   GET   listado: q, activo, page, pageSize
//   POST  alta: { nombre, email, rol, password }
// Acá no hay reglas (tampoco el chequeo de admin): están en
// lib/servicios/usuarios.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { crearUsuario, listarUsuarios } from '@/lib/servicios/usuarios';

// GET /api/usuarios?q=laura&activo=true&page=1
export async function GET(request: Request) {
    try {
        // Toda ruta exige sesión (sección 11.1)
        const usuario = await obtenerUsuarioActual();
        if (!usuario) {
            throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
        }

        // "|| null": un parámetro vacío (?q=) cuenta como si no hubiera venido
        const parametros = new URL(request.url).searchParams;
        const resultado = await listarUsuarios(usuario, {
            q: parametros.get('q') || null,
            activo: parametros.get('activo') || null,
            page: parametros.get('page') || null,
            pageSize: parametros.get('pageSize') || null,
        });

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}

// POST /api/usuarios — el formato del cuerpo está en crearUsuario()
export async function POST(request: Request) {
    try {
        const usuario = await obtenerUsuarioActual();
        if (!usuario) {
            throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
        }

        // request.json() falla si el texto no es JSON válido (400)
        let cuerpo;
        try {
            cuerpo = await request.json();
        } catch {
            throw new ApiError(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
        }
        if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
            throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
        }

        const nuevo = await crearUsuario(usuario, cuerpo);

        // 201 = "se creó algo nuevo"
        return Response.json(nuevo, { status: 201 });
    } catch (error) {
        return manejarError(error);
    }
}
