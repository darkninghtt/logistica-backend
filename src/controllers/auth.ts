import type { RequestHandler, Response } from 'express';
import { UnauthorizedError } from '../domain/errors';
import { loginSchema } from '../schemas/auth';
import { parseWith } from '../schemas/parse';
import type { AuthService, SessionResult } from '../services/auth';

export const REFRESH_COOKIE = 'refresh_token';
// La cookie solo viaja a los endpoints de sesión, no a toda la API
const COOKIE_PATH = '/api/auth';

export interface AuthController {
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
}

export interface CookieOptions {
  /** `Secure` exige HTTPS; en desarrollo local (http://localhost) se desactiva. */
  secure: boolean;
}

/** Lee una cookie del encabezado `Cookie` sin depender de una librería. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator !== -1 && part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}

/** Solo HTTP: valida la entrada, llama al servicio y responde. */
export function createAuthController(
  service: AuthService,
  { secure }: CookieOptions,
): AuthController {
  function setRefreshCookie(res: Response, { refresh }: SessionResult): void {
    res.cookie(REFRESH_COOKIE, refresh.token, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: COOKIE_PATH,
      expires: refresh.expiresAt,
    });
  }

  // El refresh token nunca va en el cuerpo de la respuesta, solo en la cookie
  function sendSession(res: Response, result: SessionResult): void {
    setRefreshCookie(res, result);
    res.json({ accessToken: result.accessToken, user: result.user });
  }

  return {
    async login(req, res) {
      const { email, password } = parseWith(loginSchema, req.body);
      sendSession(res, await service.login(email, password));
    },

    async refresh(req, res) {
      const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (!token) {
        throw new UnauthorizedError('Falta la sesión');
      }
      sendSession(res, await service.refresh(token));
    },

    async logout(req, res) {
      const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (token) {
        await service.logout(token);
      }
      res.clearCookie(REFRESH_COOKIE, {
        httpOnly: true,
        sameSite: 'strict',
        secure,
        path: COOKIE_PATH,
      });
      res.status(204).end();
    },

    async me(req, res) {
      if (!req.auth) {
        throw new UnauthorizedError('Falta el token de acceso');
      }
      res.json(await service.me(req.auth.userId));
    },
  };
}
