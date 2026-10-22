import type { RequestHandler } from 'express';
import { ForbiddenError, UnauthorizedError } from '../domain/errors';
import type { Role } from '../domain/user';

/**
 * Deja pasar solo a los roles indicados (va después de `authenticate`). El servicio repite la
 * comprobación: este middleware es la primera barrera, no la única.
 */
export function requireRole(...allowed: Role[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new UnauthorizedError());
    } else if (!allowed.includes(req.auth.role)) {
      next(new ForbiddenError());
    } else {
      next();
    }
  };
}
