// PATCH /api/usuarios/[id] — editar o desactivar un usuario (RF-U4). Solo admin.
// Recibe cualquiera de { nombre, email, rol, activo }.
// 422 OPERACION_SOBRE_SI_MISMO si un admin intenta desactivarse o quitarse el rol.
//
// Adaptador fino (AGENTS.md sección 3): las reglas están en
// modificarUsuario(), en lib/servicios/usuarios.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { modificarUsuario } from '@/lib/servicios/usuarios';

export async function PATCH(
    request: Request,
    // En Next.js 16, params es una promesa: hay que esperarla con await
    { params }: { params: Promise<{ id: string }> }
) {
    try {
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
        const modificado = await modificarUsuario(usuario, id, cuerpo);

        return Response.json(modificado);
    } catch (error) {
        return manejarError(error);
    }
}
