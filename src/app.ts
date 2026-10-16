import express, { type Express } from 'express';
import type { Logger } from 'pino';
import swaggerUi from 'swagger-ui-express';
import { createAuthController } from './controllers/auth';
import { createProductsController } from './controllers/products';
import { createStockController } from './controllers/stock';
import { createWarehousesController } from './controllers/warehouses';
import { createHttpLogger } from './logger';
import { createAuthenticate } from './middlewares/authenticate';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { createAuthRouter } from './routes/auth';
import { createHealthRouter } from './routes/health';
import { createProductsRouter } from './routes/products';
import { createStockRouter } from './routes/stock';
import { createWarehousesRouter } from './routes/warehouses';
import type { AuthService, TokenService } from './services/auth';
import type { ProductsService } from './services/products';
import type { StockService } from './services/stock';
import type { WarehousesService } from './services/warehouses';
import { buildOpenApiSpec } from './swagger';

export interface AppDeps {
  logger: Logger;
  authService: AuthService;
  tokens: TokenService;
  warehousesService: WarehousesService;
  productsService: ProductsService;
  stockService: StockService;
}

/** Arma la aplicación Express. Las dependencias llegan desde `main.ts` (única composición). */
export function createApp({
  logger,
  authService,
  tokens,
  warehousesService,
  productsService,
  stockService,
}: AppDeps): Express {
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
  app.use('/api/warehouses', createWarehousesRouter(createWarehousesController(warehousesService)));
  app.use('/api/products', createProductsRouter(createProductsController(productsService)));
  app.use('/api/stock', createStockRouter(createStockController(stockService)));

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
