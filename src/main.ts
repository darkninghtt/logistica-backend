import { createApp } from './app';
import { loadConfig } from './config';
import { createPool, withTransaction } from './db';
import { createLogger } from './logger';
import { createRefreshTokensRepository } from './repositories/refresh-tokens';
import { createProductsRepository } from './repositories/products';
import { createStockRepository } from './repositories/stock';
import { createStockQueryRepository } from './repositories/stock-queries';
import {
  createTransfersReadRepository,
  createTransfersWriteRepository,
} from './repositories/transfers';
import { createUsersRepository } from './repositories/users';
import { createWarehousesRepository } from './repositories/warehouses';
import { createAuthService } from './services/auth';
import { createArgon2Hasher } from './services/password-hasher';
import { createProductsService } from './services/products';
import { createSessionService } from './services/sessions';
import { createStockService } from './services/stock';
import { createStockQueryService } from './services/stock-queries';
import { createTokenService } from './services/token-service';
import { createTransfersService } from './services/transfers';
import { createUserManagementService } from './services/user-management';
import { createWarehousesService } from './services/warehouses';
import { createWarehouseAccess } from './services/warehouse-access';

function main(): void {
  const config = loadConfig(process.env);
  const logger = createLogger(config);

  // Única composición: aquí se crean las dependencias y se inyectan hacia abajo
  const pool = createPool(config.DATABASE_URL);
  const tokens = createTokenService({
    secret: config.JWT_SECRET,
    expiresInSeconds: config.JWT_ACCESS_TTL_SECONDS,
  });
  const usersRepository = createUsersRepository(pool);
  const sessions = createSessionService({
    store: createRefreshTokensRepository(pool),
    runInTransaction: (work) =>
      withTransaction(pool, (client) => work(createRefreshTokensRepository(client))),
    users: usersRepository,
    ttlSeconds: config.REFRESH_TTL_SECONDS,
  });
  const authService = createAuthService({
    users: usersRepository,
    hasher: createArgon2Hasher(),
    tokens,
    sessions,
  });
  const access = createWarehouseAccess({
    assignments: { warehouseIdsOf: (userId) => usersRepository.warehouseIdsOf(userId) },
  });
  const warehousesService = createWarehousesService({
    warehouses: createWarehousesRepository(pool),
    access,
  });
  const productsService = createProductsService({ products: createProductsRepository(pool) });
  const stockService = createStockService({
    access,
    runInTransaction: (work) =>
      withTransaction(pool, (client) => work(createStockRepository(client))),
  });
  const stockQueryService = createStockQueryService({
    store: createStockQueryRepository(pool),
    access,
  });
  const transfersService = createTransfersService({
    store: createTransfersReadRepository(pool),
    runInTransaction: (work) =>
      withTransaction(pool, (client) =>
        work({
          transfers: createTransfersWriteRepository(client),
          stock: createStockRepository(client),
        }),
      ),
    access,
  });
  const userManagementService = createUserManagementService({
    users: usersRepository,
    hasher: createArgon2Hasher(),
  });
  const app = createApp({
    logger,
    authService,
    tokens,
    warehousesService,
    productsService,
    stockService,
    stockQueryService,
    transfersService,
    userManagementService,
    trustProxy: config.TRUST_PROXY,
    cookieSecure: config.COOKIE_SECURE,
    rateLimits: {
      general: {
        limit: config.RATE_LIMIT_GENERAL_MAX,
        windowMs: config.RATE_LIMIT_GENERAL_WINDOW_SECONDS * 1000,
      },
      auth: {
        limit: config.RATE_LIMIT_AUTH_MAX,
        windowMs: config.RATE_LIMIT_AUTH_WINDOW_SECONDS * 1000,
      },
      refresh: {
        limit: config.RATE_LIMIT_REFRESH_MAX,
        windowMs: config.RATE_LIMIT_AUTH_WINDOW_SECONDS * 1000,
      },
    },
    publicDir: config.PUBLIC_DIR,
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
