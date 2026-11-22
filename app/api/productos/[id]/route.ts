// PATCH /api/productos/[id] — editar o dar de baja un producto (RF-P2, RF-P3).
// Solo admin.
//
// La carpeta [id] con corchetes le dice a Next.js que esa parte de la URL
// es variable: /api/productos/63 llega acá con id = "63".
//
// Recibe cualquiera de: { codigo, descripcion, categoriaId, precio,
// stockMinimo, activo }. "existencia" se rechaza con 422.
//
// Adaptador fino (AGENTS.md sección 3): las reglas están en
// modificarProducto(), en lib/servicios/productos.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { modificarProducto } from '@/lib/servicios/productos';

export async function PATCH(
    request: Request,
    // En Next.js 16, params es una promesa: hay que esperarla con await
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        // Toda ruta exige sesión (sección 11.1)
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

        if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
            throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
        }

        const { id } = await params;
        const producto = await modificarProducto(usuario, id, cuerpo);

        // 200 = se modificó algo que ya existía (no se creó nada nuevo)
        return Response.json(producto);
    } catch (error) {
        return manejarError(error);
    }
}
