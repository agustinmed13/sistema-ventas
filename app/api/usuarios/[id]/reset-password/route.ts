// POST /api/usuarios/[id]/reset-password — restablecer la contraseña (RF-U5).
// Solo admin. No recibe cuerpo. Responde 200 con { "passwordTemporal": "..." },
// que se muestra UNA sola vez (consigna, sección 11.3).
//
// Adaptador fino (AGENTS.md sección 3): las reglas están en
// restablecerContrasena(), en lib/servicios/usuarios.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { restablecerContrasena } from '@/lib/servicios/usuarios';

export async function POST(
    request: Request,
    // En Next.js 16, params es una promesa: hay que esperarla con await
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const usuario = await obtenerUsuarioActual();
        if (!usuario) {
            throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
        }

        const { id } = await params;
        const resultado = await restablecerContrasena(usuario, id);

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}
