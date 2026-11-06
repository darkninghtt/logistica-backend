import type { Request, RequestHandler, Response } from 'express';
import { UnauthorizedError } from '../domain/errors';
import { changePasswordSchema, loginSchema } from '../schemas/auth';
import { idParamSchema } from '../schemas/page';
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
  sessions: RequestHandler;
  revokeSession: RequestHandler;
  logoutAll: RequestHandler;
  changePassword: RequestHandler;
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

  function clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      sameSite: 'strict',
      secure,
      path: COOKIE_PATH,
    });
  }

  /** Usuario del access token (estas rutas pasan antes por `authenticate`). */
  function userIdOf(req: Request): string {
    if (!req.auth) {
      throw new UnauthorizedError('Falta el token de acceso');
    }
    return req.auth.userId;
  }

  // El refresh token nunca va en el cuerpo de la respuesta, solo en la cookie
  function sendSession(res: Response, result: SessionResult): void {
    setRefreshCookie(res, result);
    res.json({ accessToken: result.accessToken, user: result.user });
  }

  return {
    async login(req, res) {
      const { email, password } = parseWith(loginSchema, req.body);
      sendSession(res, await service.login(email, password, req.get('user-agent')));
    },

    async refresh(req, res) {
      const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (!token) {
        throw new UnauthorizedError('Falta la sesión');
      }
      sendSession(res, await service.refresh(token, req.get('user-agent')));
    },

    async logout(req, res) {
      const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
      if (token) {
        await service.logout(token);
      }
      clearRefreshCookie(res);
      res.status(204).end();
    },

    async me(req, res) {
      if (!req.auth) {
        throw new UnauthorizedError('Falta el token de acceso');
      }
      res.json(await service.me(req.auth.userId));
    },

    // La cookie del refresh (Path=/api/auth) llega aquí y sirve para marcar la sesión actual
    async sessions(req, res) {
      const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
      res.json(await service.listSessions(userIdOf(req), token));
    },

    async revokeSession(req, res) {
      const { id } = parseWith(idParamSchema, req.params);
      await service.revokeSession(userIdOf(req), id);
      res.status(204).end();
    },

    async logoutAll(req, res) {
      await service.logoutAll(userIdOf(req));
      clearRefreshCookie(res);
      res.status(204).end();
    },

    async changePassword(req, res) {
      const input = parseWith(changePasswordSchema, req.body);
      const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
      await service.changePassword(userIdOf(req), input, token);
      res.status(204).end();
    },
  };
}
