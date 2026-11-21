// Funciones que arman las respuestas de error de la API.
//
// Todas devuelven el mismo formato (ver AGENTS.md, sección 5):
//
//   { "error": { "codigo": "...", "mensaje": "...", "detalles": { ... } } }
//
// y el código HTTP que corresponde. Uso típico en una ruta:
//
//   if (!usuario) return errorNoAutorizado();
//
// Response.json(cuerpo, { status }) es una función estándar de la web:
// convierte el objeto a JSON y arma la respuesta HTTP con ese código.

// 400 — El pedido llegó mal armado (por ejemplo, el cuerpo no es JSON válido).
export function errorSolicitudInvalida(mensaje = 'La solicitud está mal formada.', detalles = {}) {
  return Response.json(
    { error: { codigo: 'SOLICITUD_INVALIDA', mensaje, detalles } },
    { status: 400 }
  );
}

// 401 — No hay sesión válida, o el usuario/contraseña son incorrectos.
export function errorNoAutorizado(mensaje = 'Tenés que iniciar sesión.', detalles = {}) {
  return Response.json(
    { error: { codigo: 'NO_AUTORIZADO', mensaje, detalles } },
    { status: 401 }
  );
}

// 403 — Hay sesión, pero el perfil no tiene permiso para esta operación.
export function errorProhibido(mensaje = 'No tenés permiso para esta operación.', detalles = {}) {
  return Response.json(
    { error: { codigo: 'PROHIBIDO', mensaje, detalles } },
    { status: 403 }
  );
}

// 404 — El recurso pedido no existe.
export function errorNoEncontrado(mensaje = 'El recurso no existe.', detalles = {}) {
  return Response.json(
    { error: { codigo: 'NO_ENCONTRADO', mensaje, detalles } },
    { status: 404 }
  );
}

// 409 — Conflicto con el estado actual de los datos.
// Acá el código SÍ se pasa siempre, porque hay varios conflictos distintos y
// el cliente necesita saber cuál fue. Ejemplo:
//   return errorConflicto('STOCK_INSUFICIENTE', 'No hay stock suficiente.', { productoId: 1, disponible: 3, solicitado: 5 });
export function errorConflicto(codigo, mensaje, detalles = {}) {
  return Response.json(
    { error: { codigo, mensaje, detalles } },
    { status: 409 }
  );
}

// 422 — El JSON está bien armado, pero los datos no cumplen una regla.
// En "detalles" conviene indicar qué campo falló. Ejemplo:
//   return errorValidacion('El precio debe ser mayor a cero.', { campo: 'precioCentavos' });
export function errorValidacion(mensaje, detalles = {}) {
  return Response.json(
    { error: { codigo: 'VALIDACION', mensaje, detalles } },
    { status: 422 }
  );
}

// 500 — Error inesperado. Nunca se manda el detalle interno al cliente
// (podría mostrar partes del código o de la base). Se registra en la consola
// del servidor y al cliente le llega un mensaje genérico.
export function errorInterno(errorOriginal) {
  console.error(errorOriginal);
  return Response.json(
    { error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error inesperado.', detalles: {} } },
    { status: 500 }
  );
}
