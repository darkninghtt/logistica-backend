import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';
import pino, { type DestinationStream, type Logger } from 'pino';
import pinoHttp, { type HttpLogger } from 'pino-http';
import type { Config } from './config';

export const CORRELATION_HEADER = 'x-correlation-id';

// Solo se acepta un id razonable del cliente; si no, se genera uno (evita inyectar basura en los logs).
const VALID_CORRELATION_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function createLogger(
  config: Pick<Config, 'LOG_LEVEL'>,
  destination?: DestinationStream,
): Logger {
  return pino(
    {
      level: config.LOG_LEVEL,
      // Nunca registrar credenciales ni cookies
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    destination,
  );
}

/** Toma `x-correlation-id` de la petición o genera uno, y lo devuelve también en la respuesta. */
function resolveCorrelationId(req: IncomingMessage, res: ServerResponse): string {
  const header = req.headers[CORRELATION_HEADER];
  const id =
    typeof header === 'string' && VALID_CORRELATION_ID.test(header) ? header : randomUUID();
  res.setHeader(CORRELATION_HEADER, id);
  return id;
}

/** Middleware que registra cada petición con pino; `req.id` es el correlation id. */
export function createHttpLogger(logger: Logger): HttpLogger {
  return pinoHttp({
    logger,
    genReqId: resolveCorrelationId,
    customProps: (req) => ({ correlationId: req.id }),
  });
}

/** Correlation id de la petición en curso: permite registrarlo desde capas que no ven `req`. */
export const correlationContext = new AsyncLocalStorage<string>();

/** Va después del logger HTTP: ejecuta el resto de la petición con su correlation id disponible. */
export const bindCorrelationId: RequestHandler = (req, _res, next) => {
  correlationContext.run(String(req.id), next);
};
