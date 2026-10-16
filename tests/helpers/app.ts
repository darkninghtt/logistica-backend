import type { Express } from 'express';
import type { Pool } from 'pg';
import pino from 'pino';
import { createApp } from '../../src/app';
import { createUsersRepository } from '../../src/repositories/users';
import { createWarehousesRepository } from '../../src/repositories/warehouses';
import { createAuthService, type TokenService } from '../../src/services/auth';
import { createArgon2Hasher } from '../../src/services/password-hasher';
import { createTokenService } from '../../src/services/token-service';
import { createUsersService } from '../../src/services/users';
import { createWarehousesService } from '../../src/services/warehouses';

export const TEST_JWT_SECRET = 'secreto-solo-para-pruebas-con-mas-de-32-caracteres';
export const ADMIN = { email: 'admin@example.com', password: 'Clave-segura-123', name: 'Admin' };

export interface TestApp {
  app: Express;
  tokens: TokenService;
}

/** Compone la app real (mismas piezas que main.ts) contra la BD de pruebas. */
export function buildTestApp(pool: Pool, expiresInSeconds = 900): TestApp {
  const hasher = createArgon2Hasher();
  const users = createUsersRepository(pool);
  const tokens = createTokenService({ secret: TEST_JWT_SECRET, expiresInSeconds });
  const authService = createAuthService({ users, hasher, tokens });
  const warehousesService = createWarehousesService({
    warehouses: createWarehousesRepository(pool),
  });
  const app = createApp({
    logger: pino({ level: 'silent' }),
    authService,
    tokens,
    warehousesService,
  });
  return { app, tokens };
}

/** Crea el ADMIN de pruebas (con la misma lógica del seed real). */
export async function seedTestAdmin(pool: Pool): Promise<void> {
  const service = createUsersService({
    users: createUsersRepository(pool),
    hasher: createArgon2Hasher(),
  });
  await service.ensureAdmin(ADMIN);
}
