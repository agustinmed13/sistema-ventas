// POST /api/auth/login — iniciar sesión (RF-U1)
// Es la ÚNICA ruta pública: no exige sesión (sección 11.1).
//
// Recibe: { "email": "admin@mostrador.com", "password": "..." }
// El campo se llama "password" porque así lo pide la consigna (sección 11.3).
// Responde 200: { id, nombre, email, rol }
//
// Adaptador fino (AGENTS.md sección 3): lee el cuerpo, llama al servicio
// y responde. Las reglas del login están en lib/servicios/autenticacion.ts.

import { ApiError, manejarError } from '@/lib/errores';
import { iniciarSesion } from '@/lib/servicios/autenticacion';

export async function POST(request: Request) {
  try {
    // Leer el cuerpo. request.json() falla si el texto no es JSON válido.
    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      throw new ApiError(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
    }
    // Un JSON válido también puede ser null, un número o una lista.
    // Necesitamos un objeto para poder leer cuerpo.email.
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
    }

    const usuario = await iniciarSesion(cuerpo.email, cuerpo.password);
    return Response.json(usuario);
  } catch (error) {
    return manejarError(error);
  }
}
