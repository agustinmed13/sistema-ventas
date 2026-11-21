// Errores de la API (consigna, secciones 10.4 y 11.1).
//
// Cómo se usa:
//   - Los SERVICIOS lanzan un ApiError cuando algo no se puede hacer:
//       throw new ApiError(409, 'STOCK_INSUFICIENTE', 'No hay stock de Café.');
//   - Las RUTAS envuelven todo en try/catch y en el catch llaman a
//     manejarError(error), que arma la respuesta HTTP.
//
// Formato de la respuesta (sección 11.1):
//   {
//     "error": {
//       "code": "VALIDACION",
//       "message": "Hay campos con errores.",
//       "details": [{ "campo": "email", "mensaje": "Es obligatorio." }]
//     }
//   }
// "details" es opcional y, cuando está, es un ARREGLO.

// ─────────────────────────────────────────────────────────────
// Los 22 códigos válidos (sección 11.8). Al ser un tipo, TypeScript
// marca error si alguien escribe un código que no está en la lista.
//
// Criterio para elegir entre 409 y 422:
//   409 → el pedido choca con el ESTADO ACTUAL de los datos
//         (ya existe ese código, no queda stock, la factura ya está anulada)
//   422 → el pedido está bien formado pero ROMPE UNA REGLA de negocio
//         (supera el límite de crédito, paga más de lo que debe)
// ─────────────────────────────────────────────────────────────
export type CodigoError =
  // 400
  | 'JSON_INVALIDO'
  // 401
  | 'NO_AUTENTICADO'
  | 'CREDENCIALES_INVALIDAS'
  // 403
  | 'SIN_PERMISO'
  // 404
  | 'NO_ENCONTRADO'
  // 409
  | 'CODIGO_DUPLICADO'
  | 'DOCUMENTO_DUPLICADO'
  | 'EMAIL_DUPLICADO'
  | 'NOMBRE_DUPLICADO'
  | 'CATEGORIA_EN_USO'
  | 'STOCK_INSUFICIENTE'
  | 'FACTURA_ANULADA'
  // 422
  | 'VALIDACION'
  | 'PRODUCTO_INACTIVO'
  | 'CUENTA_CORRIENTE_NO_HABILITADA'
  | 'LIMITE_CREDITO_EXCEDIDO'
  | 'MONTO_INSUFICIENTE'
  | 'PAGO_SUPERA_DEUDA'
  | 'SALDO_PENDIENTE'
  | 'CONTRASENA_ACTUAL_INCORRECTA'
  | 'OPERACION_SOBRE_SI_MISMO'
  // 500
  | 'ERROR_INTERNO';

// Los códigos HTTP que usa la API (sección 11.8)
export type StatusError = 400 | 401 | 403 | 404 | 409 | 422 | 500;

// Un elemento de "details": qué campo falló y por qué
export type DetalleError = { campo: string; mensaje: string };

// ─────────────────────────────────────────────────────────────
// ApiError — la ÚNICA clase de error que lanzan los servicios (sección 10.4)
//
// "extends Error" = es un Error común (tiene message, aparece en los logs)
// con tres datos más: el status HTTP, el código y los detalles.
// ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  status: StatusError;
  code: CodigoError;
  details?: DetalleError[];

  constructor(status: StatusError, code: CodigoError, message: string, details?: DetalleError[]) {
    super(message); // guarda el mensaje en this.message, como cualquier Error
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// ─────────────────────────────────────────────────────────────
// Convierte un ApiError en la respuesta HTTP con el formato de la 11.1
// ─────────────────────────────────────────────────────────────
export function respuestaDeError(error: ApiError) {
  const cuerpo: { code: CodigoError; message: string; details?: DetalleError[] } = {
    code: error.code,
    message: error.message,
  };
  // details solo va si hay detalles
  if (error.details) {
    cuerpo.details = error.details;
  }
  return Response.json({ error: cuerpo }, { status: error.status });
}

// ─────────────────────────────────────────────────────────────
// Lo que va en el catch de TODAS las rutas:
//
//   } catch (error) {
//     return manejarError(error);
//   }
//
// - Si es un ApiError (un error "esperado", lanzado a propósito por un
//   servicio), lo traduce a su respuesta.
// - Si es cualquier otra cosa (se cayó la base, un bug), registra el
//   detalle en la consola del SERVIDOR y al cliente le manda solo un 500
//   genérico. Nunca se exponen mensajes técnicos ni partes del código.
//
// "unknown" porque en un catch puede llegar cualquier cosa.
// ─────────────────────────────────────────────────────────────
export function manejarError(error: unknown) {
  if (error instanceof ApiError) {
    return respuestaDeError(error);
  }

  console.error(error);
  return Response.json(
    { error: { code: 'ERROR_INTERNO', message: 'Ocurrió un error inesperado.' } },
    { status: 500 }
  );
}
