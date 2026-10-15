import express, { type Express } from 'express';
import type { Logger } from 'pino';
import swaggerUi from 'swagger-ui-express';
import { createAuthController } from './controllers/auth';
import { createHttpLogger } from './logger';
import { createAuthenticate } from './middlewares/authenticate';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { createAuthRouter } from './routes/auth';
import { createHealthRouter } from './routes/health';
import type { AuthService, TokenService } from './services/auth';
import { buildOpenApiSpec } from './swagger';

export interface AppDeps {
  logger: Logger;
  authService: AuthService;
  tokens: TokenService;
}

/** Arma la aplicación Express. Las dependencias llegan desde `main.ts` (única composición). */
export function createApp({ logger, authService, tokens }: AppDeps): Express {
  const app = express();
  const authenticate = createAuthenticate(tokens);
  const openApiSpec = buildOpenApiSpec();

  app.disable('x-powered-by');
  app.use(createHttpLogger(logger));
  app.use(express.json());

  // Públicos
  app.use(createHealthRouter());
  app.get('/api-docs.json', (_req, res) => {
    res.json(openApiSpec);
  });
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openApiSpec));

  // /api: solo el login es público; el resto exige token
  app.use('/api/auth', createAuthRouter(createAuthController(authService), authenticate));
  app.use('/api', authenticate);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
