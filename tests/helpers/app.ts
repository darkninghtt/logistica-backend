import type { Express } from 'express';
import type { Pool } from 'pg';
import pino from 'pino';
import { createApp, type AppDeps } from '../../src/app';
import { withTransaction } from '../../src/db';
import type { EventPublisher } from '../../src/domain/realtime';
import { createRefreshTokensRepository } from '../../src/repositories/refresh-tokens';
import { createProductsRepository } from '../../src/repositories/products';
import { createStockRepository } from '../../src/repositories/stock';
import { createStockQueryRepository } from '../../src/repositories/stock-queries';
import {
  createTransfersReadRepository,
  createTransfersWriteRepository,
} from '../../src/repositories/transfers';
import { createUsersRepository } from '../../src/repositories/users';
import { createWarehousesRepository } from '../../src/repositories/warehouses';
import { createAuthService, type TokenService } from '../../src/services/auth';
import { createArgon2Hasher } from '../../src/services/password-hasher';
import { createProductsService } from '../../src/services/products';
import { createRealtimeService, type RealtimeService } from '../../src/services/realtime';
import { createSessionService } from '../../src/services/sessions';
import { createStockService } from '../../src/services/stock';
import { createStockQueryService } from '../../src/services/stock-queries';
import { createTokenService } from '../../src/services/token-service';
import { createTransfersService } from '../../src/services/transfers';
import { createUserManagementService } from '../../src/services/user-management';
import { createUsersService } from '../../src/services/users';
import { createWarehousesService } from '../../src/services/warehouses';
import { createWarehouseAccess } from '../../src/services/warehouse-access';
import { createTaskQueue, type TaskQueue } from '../../src/task-queue';

export const TEST_JWT_SECRET = 'secreto-solo-para-pruebas-con-mas-de-32-caracteres';
export const ADMIN = { email: 'admin@example.com', password: 'Clave-segura-123', name: 'Admin' };

export interface TestApp {
  app: Express;
  tokens: TokenService;
  /** Dependencias con las que se armó la app (para volver a armarla con opciones extra). */
  deps: AppDeps;
  realtime: RealtimeService;
  /** Cola de los avisos de tiempo real (`idle()` espera a que se envíen). */
  queue: TaskQueue;
}

/** Compone la app real (mismas piezas que main.ts) contra la BD de pruebas. */
export function buildTestApp(pool: Pool, expiresInSeconds = 900): TestApp {
  const hasher = createArgon2Hasher();
  const users = createUsersRepository(pool);
  const tokens = createTokenService({ secret: TEST_JWT_SECRET, expiresInSeconds });
  const sessions = createSessionService({
    store: createRefreshTokensRepository(pool),
    runInTransaction: (work) =>
      withTransaction(pool, (client) => work(createRefreshTokensRepository(client))),
    users,
    ttlSeconds: 604800,
  });
  const authService = createAuthService({ users, hasher, tokens, sessions });
  const access = createWarehouseAccess({
    assignments: { warehouseIdsOf: (userId) => users.warehouseIdsOf(userId) },
  });
  const realtime = createRealtimeService({ access });
  const logger = pino({ level: 'silent' });
  const queue = createTaskQueue({ logger });
  const events: EventPublisher = {
    publish: (event) => queue.enqueue(event.type, () => realtime.publish(event)),
  };
  const warehousesService = createWarehousesService({
    warehouses: createWarehousesRepository(pool),
    access,
  });
  const productsService = createProductsService({ products: createProductsRepository(pool) });
  const stockService = createStockService({
    access,
    events,
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
    events,
  });
  const userManagementService = createUserManagementService({ users, hasher });
  const deps: AppDeps = {
    logger,
    authService,
    tokens,
    warehousesService,
    productsService,
    stockService,
    stockQueryService,
    transfersService,
    userManagementService,
    realtimeService: realtime,
  };
  return { app: createApp(deps), tokens, deps, realtime, queue };
}

/** Crea el ADMIN de pruebas (con la misma lógica del seed real). */
export async function seedTestAdmin(pool: Pool): Promise<void> {
  const service = createUsersService({
    users: createUsersRepository(pool),
    hasher: createArgon2Hasher(),
  });
  await service.ensureAdmin(ADMIN);
}
