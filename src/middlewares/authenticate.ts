import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../domain/errors';
import type { AuthIdentity, TokenService } from '../services/auth';

declare module 'express-serve-static-core' {
  interface Request {
    /** Identidad del token; solo existe después de pasar por `authenticate`. */
    auth?: AuthIdentity;
  }
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
