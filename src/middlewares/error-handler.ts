import type { ErrorRequestHandler, RequestHandler } from 'express';
import { AppError, NotFoundError, ValidationError } from '../domain/errors';

export interface ErrorBody {
  code: string;
  message: string;
  correlationId: string;
}

/** Rutas que no existen: se convierten en un NotFoundError y pasan por el manejador global. */
export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new NotFoundError('Ruta no encontrada'));
};

// express.json() lanza este error cuando el cuerpo no es JSON válido
function isBodyParseError(err: unknown): boolean {
  return (
    typeof err === 'object' && err !== null && 'type' in err && err.type === 'entity.parse.failed'
  );
}

/** Único punto donde los errores se traducen a HTTP. Nunca expone `err.message` interno ni el stack. */
export const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (res.headersSent) {
    next(err);
    return;
  }

  const correlationId = String(req.id);
  let appError: AppError;

  if (err instanceof AppError) {
    appError = err;
  } else if (isBodyParseError(err)) {
    appError = new ValidationError('El cuerpo de la petición no es un JSON válido');
  } else {
    req.log.error({ err }, 'Error no controlado');
    appError = new AppError('INTERNAL_ERROR', 500, 'Error interno del servidor');
  }

  const body: ErrorBody = { code: appError.code, message: appError.message, correlationId };
  res.status(appError.status).json(body);
};
