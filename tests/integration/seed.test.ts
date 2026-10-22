import type { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createUsersRepository } from '../../src/repositories/users';
import { createWarehouseSeedRepository } from '../../src/repositories/warehouses';
import { buildSeedPlan } from '../../src/seed-plan';
import { createArgon2Hasher } from '../../src/services/password-hasher';
import { createSeedService } from '../../src/services/seed';
import { createUsersService } from '../../src/services/users';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();

const plan = buildSeedPlan({
  SEED_ADMIN_EMAIL: 'admin@logistica.local',
  SEED_ADMIN_PASSWORD: 'Admin-dev-2026!',
  SEED_MANAGER_EMAIL: 'jefe@logistica.local',
  SEED_MANAGER_PASSWORD: 'Jefe-dev-2026!',
  SEED_OPERATOR_EMAIL: 'operario@logistica.local',
  SEED_OPERATOR_PASSWORD: 'Operario-dev-2026!',
  SEED_AUDITOR_EMAIL: 'auditor@logistica.local',
  SEED_AUDITOR_PASSWORD: 'Auditor-dev-2026!',
});

/** Compone el seed igual que src/seed.ts. */
function runSeed(): ReturnType<ReturnType<typeof createSeedService>['run']> {
  const users = createUsersRepository(pool);
  const usersService = createUsersService({ users, hasher: createArgon2Hasher() });
  const warehouses = createWarehouseSeedRepository(pool);
  return createSeedService({
    ensureUser: (user) => usersService.ensureUser(user),
    async findUserId(email) {
      return (await users.findByEmail(email))?.id ?? null;
    },
    ensureWarehouse: (warehouse) => warehouses.ensureByCode(warehouse),
    addWarehouses: (userId, ids) => users.addWarehouses(userId, ids),
  }).run(plan);
}

async function count(table: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('seed contra la BD', () => {
  it('deja un usuario de cada rol y asigna bodegas al jefe y al operario', async () => {
    await runSeed();

    const { rows } = await pool.query<{ role: string }>('SELECT role FROM users ORDER BY role');
    expect(rows.map((r) => r.role)).toEqual(['ADMIN', 'AUDITOR', 'OPERATOR', 'WAREHOUSE_MANAGER']);
    expect(await count('warehouses')).toBe(2);

    const assigned = await pool.query<{ role: string; code: string }>(
      `SELECT u.role, w.code FROM user_warehouses uw
       JOIN users u ON u.id = uw.user_id JOIN warehouses w ON w.id = uw.warehouse_id
       ORDER BY u.role`,
    );
    expect(assigned.rows).toEqual([
      { role: 'OPERATOR', code: 'BOD-A' },
      { role: 'WAREHOUSE_MANAGER', code: 'BOD-A' },
    ]);
  });

  it('correrlo dos veces no duplica nada', async () => {
    await runSeed();
    const second = await runSeed();

    expect(second.createdUsers).toEqual([]);
    expect(second.existingUsers).toHaveLength(4);
    expect(await count('users')).toBe(4);
    expect(await count('warehouses')).toBe(2);
    expect(await count('user_warehouses')).toBe(2);
  });
});
