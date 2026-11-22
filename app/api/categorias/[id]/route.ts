// PATCH /api/categorias/[id] — renombrar o desactivar una categoría (RF-P7).
// Solo admin. Recibe cualquiera de { "nombre": "...", "activa": false }.
// Desactivar una categoría con productos activos → 409 CATEGORIA_EN_USO.
//
// Adaptador fino (AGENTS.md sección 3): las reglas están en
// modificarCategoria(), en lib/servicios/productos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { modificarCategoria } from '@/lib/servicios/productos';

export async function PATCH(
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
        const categoria = await modificarCategoria(usuario, id, cuerpo);

        return Response.json(categoria);
    } catch (error) {
        return manejarError(error);
    }
}
