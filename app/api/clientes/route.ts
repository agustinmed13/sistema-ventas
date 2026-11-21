// /api/clientes
//   GET   listado con búsqueda, saldos y paginación (RF-C1, RF-C6)
//   POST  alta de un cliente (RF-C2)
//
// Adaptador fino (AGENTS.md sección 3): exige la sesión, lee el pedido,
// llama al servicio y responde. NO hay validaciones ni reglas acá:
// están en lib/servicios/clientes.ts.

import { obtenerUsuarioActual } from '@/lib/auth';
import { ApiError, manejarError } from '@/lib/errores';
import { listarClientes, crearCliente } from '@/lib/servicios/clientes';

// GET /api/clientes?q=perez&conDeuda=true&orden=saldo&page=1&pageSize=20
export async function GET(request: Request) {
  try {
    // Toda ruta exige sesión (sección 11.1)
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    // searchParams = lo que viene después del "?" en la URL.
    // "|| null" hace que un parámetro vacío (?q=) cuente como si no
    // hubiera venido. Validarlos es trabajo del servicio.
    const parametros = new URL(request.url).searchParams;
    const resultado = await listarClientes(usuario, {
      q: parametros.get('q') || null,
      conDeuda: parametros.get('conDeuda') || null,
      orden: parametros.get('orden') || null,
      page: parametros.get('page') || null,
      pageSize: parametros.get('pageSize') || null,
    });

    // 200 con { data, page, pageSize, total }
    return Response.json(resultado);
  } catch (error) {
    // ApiError → su respuesta; cualquier otro error → 500 genérico
    return manejarError(error);
  }
}

// POST /api/clientes — el formato del cuerpo está en crearCliente()
export async function POST(request: Request) {
  try {
    const usuario = await obtenerUsuarioActual();
    if (!usuario) {
      throw new ApiError(401, 'NO_AUTENTICADO', 'Tenés que iniciar sesión.');
    }

    // Leer el cuerpo. request.json() falla si el texto no es JSON válido.
    let cuerpo;
    try {
      cuerpo = await request.json();
    } catch {
      throw new ApiError(400, 'JSON_INVALIDO', 'El cuerpo no es JSON válido.');
    }
    // Un JSON válido también puede ser null, un número o una lista.
    // Necesitamos un objeto para poder leer sus campos.
    if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) {
      throw new ApiError(400, 'JSON_INVALIDO', 'Se esperaba un objeto JSON.');
    }

    const cliente = await crearCliente(usuario, cuerpo);

    // 201 = "se creó algo nuevo"
    return Response.json(cliente, { status: 201 });
  } catch (error) {
    return manejarError(error);
  }
}
