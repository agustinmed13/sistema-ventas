// PUT /api/auth/password — cambiar la contraseña propia (RF-U5). Los dos roles.
// Recibe { "actual": "...", "nueva": "..." } (nueva: mínimo 8 caracteres).
// Responde 204 sin cuerpo; 422 CONTRASENA_ACTUAL_INCORRECTA si "actual" no coincide.
//
// Adaptador fino (AGENTS.md sección 3): las reglas están en
// cambiarPassword(), en lib/servicios/usuarios.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { cambiarPassword } from '@/lib/servicios/usuarios';

export async function PUT(request: Request) {
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

        await cambiarPassword(usuario, cuerpo);

        // 204 = "salió bien y no hay nada que devolver"
        return new Response(null, { status: 204 });
    } catch (error) {
        return manejarError(error);
    }
}
