import { createApp } from './app';
import { loadConfig } from './config';
import { createPool, withTransaction } from './db';
import { createLogger } from './logger';
import { createProductsRepository } from './repositories/products';
import { createStockRepository } from './repositories/stock';
import { createStockQueryRepository } from './repositories/stock-queries';
import { createUsersRepository } from './repositories/users';
import { createWarehousesRepository } from './repositories/warehouses';
import { createAuthService } from './services/auth';
import { createArgon2Hasher } from './services/password-hasher';
import { createProductsService } from './services/products';
import { createStockService } from './services/stock';
import { createStockQueryService } from './services/stock-queries';
import { createTokenService } from './services/token-service';
import { createWarehousesService } from './services/warehouses';

function main(): void {
  const config = loadConfig(process.env);
  const logger = createLogger(config);

  // Única composición: aquí se crean las dependencias y se inyectan hacia abajo
  const pool = createPool(config.DATABASE_URL);
  const tokens = createTokenService({
    secret: config.JWT_SECRET,
    expiresInSeconds: config.JWT_ACCESS_TTL_SECONDS,
  });
  const authService = createAuthService({
    users: createUsersRepository(pool),
    hasher: createArgon2Hasher(),
    tokens,
  });
  const warehousesService = createWarehousesService({
    warehouses: createWarehousesRepository(pool),
  });
  const productsService = createProductsService({ products: createProductsRepository(pool) });
  const stockService = createStockService({
    runInTransaction: (work) =>
      withTransaction(pool, (client) => work(createStockRepository(client))),
  });
  const stockQueryService = createStockQueryService({ store: createStockQueryRepository(pool) });
  const app = createApp({
    logger,
    authService,
    tokens,
    warehousesService,
    productsService,
    stockService,
    stockQueryService,
  });

  app.listen(config.PORT, () => {
    logger.info({ port: config.PORT, env: config.NODE_ENV }, 'Servidor escuchando');
  });
}

try {
  main();
} catch (err) {
  // Aún no hay logger si la configuración falla, por eso se escribe directo a stderr
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
