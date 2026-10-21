import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { TooManyRequestsError } from '../domain/errors';

export interface LimitConfig {
  windowMs: number;
  limit: number;
}

export interface RateLimits {
  /** Límite general por IP sobre toda la API. */
  general: LimitConfig;
  /** Límite estricto por IP para login y refresh (contra fuerza bruta). */
  auth: LimitConfig;
}

function build({ windowMs, limit }: LimitConfig, skipSuccessfulRequests: boolean): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests,
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
 * sin bloquear a quien inicia sesión o recarga la página con normalidad.
 */
export function createAuthLimiter(config: LimitConfig): RequestHandler {
  return build(config, true);
}
