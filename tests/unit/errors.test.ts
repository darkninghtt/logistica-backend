import { describe, expect, it } from 'vitest';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/domain/errors';

describe('errores de dominio', () => {
  it.each([
    [new ValidationError(), 'VALIDATION_ERROR', 400],
    [new UnauthorizedError(), 'UNAUTHORIZED', 401],
    [new ForbiddenError(), 'FORBIDDEN', 403],
    [new NotFoundError(), 'NOT_FOUND', 404],
    [new ConflictError(), 'CONFLICT', 409],
  ])('%o tiene código y estado HTTP estables', (error, code, status) => {
    expect(error).toBeInstanceOf(AppError);
    expect(error.code).toBe(code);
    expect(error.status).toBe(status);
  });

  it('conserva el mensaje personalizado y el nombre de la clase', () => {
    const error = new NotFoundError('Bodega no encontrada');
    expect(error.message).toBe('Bodega no encontrada');
    expect(error.name).toBe('NotFoundError');
  });
});
