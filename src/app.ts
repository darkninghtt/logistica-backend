import express, { type Express } from 'express';
import type { Logger } from 'pino';
import { createHttpLogger } from './logger';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { createHealthRouter } from './routes/health';

export interface AppDeps {
  logger: Logger;
}

/** Arma la aplicación Express. Las dependencias llegan desde `main.ts` (única composición). */
export function createApp({ logger }: AppDeps): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(createHttpLogger(logger));
  app.use(express.json());

  app.use(createHealthRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
