import express, { type Express } from 'express';
import type { Logger } from 'pino';
import swaggerUi from 'swagger-ui-express';
import { createAuthController } from './controllers/auth';
import { createProductsController } from './controllers/products';
import { createStockController } from './controllers/stock';
import { createStockQueryController } from './controllers/stock-queries';
import { createWarehousesController } from './controllers/warehouses';
import { createHttpLogger } from './logger';
import { createFrontendHandlers } from './middlewares/frontend';
import { createAuthenticate } from './middlewares/authenticate';
import { errorHandler, notFoundHandler } from './middlewares/error-handler';
import { createAuthRouter } from './routes/auth';
import { createHealthRouter } from './routes/health';
import { createProductsRouter } from './routes/products';
import { createStockRouter } from './routes/stock';
import { createStockQueryRouter } from './routes/stock-queries';
import { createWarehousesRouter } from './routes/warehouses';
import type { AuthService, TokenService } from './services/auth';
import type { ProductsService } from './services/products';
import type { StockService } from './services/stock';
import type { StockQueryService } from './services/stock-queries';
import type { WarehousesService } from './services/warehouses';
import { buildOpenApiSpec } from './swagger';

export interface AppDeps {
  logger: Logger;
  authService: AuthService;
  tokens: TokenService;
  warehousesService: WarehousesService;
  productsService: ProductsService;
  stockService: StockService;
  stockQueryService: StockQueryService;
  /** Saltos de proxy de confianza (`trust proxy`); 0 si no hay proxy delante. */
  trustProxy?: number;
  /** Carpeta con el build del frontend; si no existe o no tiene index.html, no se sirve. */
  publicDir?: string;
}

/** Arma la aplicación Express. Las dependencias llegan desde `main.ts` (única composición). */
export function createApp({
  logger,
  authService,
  tokens,
  warehousesService,
  productsService,
  stockService,
  stockQueryService,
  trustProxy = 0,
  publicDir,
}: AppDeps): Express {
  const app = express();
  const authenticate = createAuthenticate(tokens);
  const openApiSpec = buildOpenApiSpec();

  app.disable('x-powered-by');
  if (trustProxy > 0) app.set('trust proxy', trustProxy);
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
  app.use('/api/stock', createStockQueryRouter(createStockQueryController(stockQueryService)));

  // Frontend (un solo origen): archivos estáticos y fallback al router de Vue
  const frontend = publicDir === undefined ? null : createFrontendHandlers(publicDir);
  if (frontend) app.use(frontend);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
