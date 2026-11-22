// /api/productos/[id]/movimientos — adaptador fino (AGENTS.md, sección 3).
//   GET   historial del producto, del más nuevo al más viejo; los dos roles (RF-P6)
//   POST  ingreso o egreso manual; solo admin (RF-P4, RF-P5)
//         Recibe { tipo, cantidad, motivo, observacion }. 409 STOCK_INSUFICIENTE
//         si un egreso dejaría la existencia en negativo.
// Acá no hay reglas: están en lib/servicios/productos.ts (registrarMovimiento,
// listarMovimientosDeProducto).

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { listarMovimientosDeProducto, registrarMovimiento } from '@/lib/servicios/productos';

export async function GET(
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

        const { id } = await params;
        const parametros = new URL(request.url).searchParams;

        const resultado = await listarMovimientosDeProducto(usuario, id, {
            page: parametros.get('page') || null,
            pageSize: parametros.get('pageSize') || null,
        });

        return Response.json(resultado);
    } catch (error) {
        return manejarError(error);
    }
}

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
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

        const { id } = await params;
        const movimiento = await registrarMovimiento(usuario, id, cuerpo);

        // 201 = "se creó algo nuevo" (el movimiento)
        return Response.json(movimiento, { status: 201 });
    } catch (error) {
        return manejarError(error);
    }
}
