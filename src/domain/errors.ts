export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'INVALID_TRANSITION'
  | 'INSUFFICIENT_STOCK'
  | 'TOO_MANY_REQUESTS'
  | 'INTERNAL_ERROR';

/** Error de dominio con código estable y estado HTTP. El middleware global lo traduce a la respuesta. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Los datos enviados no son válidos') {
    super('VALIDATION_ERROR', 400, message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autenticado') {
    super('UNAUTHORIZED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permiso para realizar esta acción') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Recurso no encontrado') {
    super('NOT_FOUND', 404, message);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiadas peticiones, intenta de nuevo más tarde') {
    super('TOO_MANY_REQUESTS', 429, message);
  }
}

/** Conflictos 409. El código por defecto es CONFLICT; los traspasos usan INVALID_TRANSITION e INSUFFICIENT_STOCK. */
export type ConflictCode = Extract<
  ErrorCode,
  'CONFLICT' | 'INVALID_TRANSITION' | 'INSUFFICIENT_STOCK'
>;

export class ConflictError extends AppError {
  constructor(
    message = 'El recurso entra en conflicto con el estado actual',
    code: ConflictCode = 'CONFLICT',
  ) {
    super(code, 409, message);
  }
}
