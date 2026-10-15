import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../domain/errors';
import { loginSchema } from '../schemas/auth';
import { parseWith } from '../schemas/parse';
import type { AuthService } from '../services/auth';

export interface AuthController {
  login: RequestHandler;
  me: RequestHandler;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createAuthController(service: AuthService): AuthController {
  return {
    async login(req, res) {
      const { email, password } = parseWith(loginSchema, req.body);
      res.json(await service.login(email, password));
    },

    async me(req, res) {
      if (!req.auth) {
        throw new UnauthorizedError('Falta el token de acceso');
      }
      res.json(await service.me(req.auth.userId));
    },
  };
}
