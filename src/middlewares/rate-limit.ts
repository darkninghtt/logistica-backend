import type { Request, RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { TooManyRequestsError } from '../domain/errors';

export interface LimitConfig {
  windowMs: number;
  limit: number;
}

export interface RateLimits {
  /** Límite general por IP sobre toda la API. */
  general: LimitConfig;
  /** Límite estricto por IP para el login (contra fuerza bruta de contraseñas). */
  auth: LimitConfig;
  /**
   * Límite del refresh, más holgado: el token tiene 256 bits (no se puede adivinar) y recargar la
   * página varias veces seguidas deja intentos sin devolver (peticiones abortadas o con la cookie
   * ya rotada) que no deben bloquear a un usuario legítimo.
   */
  refresh: LimitConfig;
}

function build(
  { windowMs, limit }: LimitConfig,
  skipSuccessfulRequests: boolean,
  skip?: (req: Request) => boolean,
): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
    skip,
    // El 429 pasa por el middleware global de errores para tener el formato uniforme
    handler: (_req, _res, next) => {
      next(new TooManyRequestsError());
    },
  });
}

/** Cuenta todas las peticiones de la IP. */
export function createGeneralLimiter(config: LimitConfig): RequestHandler {
  return build(config, false);
}

/**
 * Para login y refresh: solo cuentan los intentos fallidos (4xx). Es lo que frena la fuerza bruta
 * sin bloquear a quien inicia sesión o recarga la página con normalidad. `skip` permite no contar
 * las peticiones que no pueden ser un ataque (por ejemplo, un refresh sin cookie).
 */
export function createAuthLimiter(
  config: LimitConfig,
  skip?: (req: Request) => boolean,
): RequestHandler {
  return build(config, true, skip);
}
