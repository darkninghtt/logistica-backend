import type { Request, RequestHandler } from 'express';
import { UnauthorizedError } from '../domain/errors';
import type { AuthIdentity, TokenService } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    /** Identidad del token; solo existe después de pasar por `authenticate`. */
    auth?: AuthIdentity;
  }
}

/** Identidad del token para los controladores; falla con 401 si la ruta no pasó por `authenticate`. */
export function getActor(req: Request): AuthIdentity {
  if (!req.auth) {
    throw new UnauthorizedError();
  }
  return req.auth;
}

const BEARER = /^Bearer (\S+)$/;

/** Exige `Authorization: Bearer <accessToken>` válido; deja la identidad en `req.auth`. */
export function createAuthenticate(tokens: TokenService): RequestHandler {
  return (req, _res, next) => {
    const match = BEARER.exec(req.headers.authorization ?? '');
    if (!match?.[1]) {
      next(new UnauthorizedError('Falta el token de acceso'));
      return;
    }
    req.auth = tokens.verify(match[1]);
    next();
  };
}
