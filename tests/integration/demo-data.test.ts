import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProductSeedRepository } from '../../src/repositories/products';
import { createUsersRepository } from '../../src/repositories/users';
import { createWarehouseSeedRepository } from '../../src/repositories/warehouses';
import { buildSeedPlan } from '../../src/seed-plan';
import { createDemoDataService, type DemoDataService } from '../../src/services/demo-data';
import { createArgon2Hasher } from '../../src/services/password-hasher';
import { createSeedService } from '../../src/services/seed';
import { createUsersService } from '../../src/services/users';
import { buildTestApp } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';
import { expectLedgerMatchesLevels } from '../helpers/ledger';

const pool: Pool = createTestPool();
const { deps } = buildTestApp(pool);

const ADMIN_EMAIL = 'admin@logistica.local';
const MANAGER_EMAIL = 'jefe@logistica.local';
const plan = buildSeedPlan({
  SEED_ADMIN_EMAIL: ADMIN_EMAIL,
  SEED_ADMIN_PASSWORD: 'Admin-dev-2026!',
  SEED_MANAGER_EMAIL: MANAGER_EMAIL,
  SEED_MANAGER_PASSWORD: 'Jefe-dev-2026!',
});

/** Compone el seed de demo igual que src/seed.ts, con los servicios reales. */
function demoService(): DemoDataService {
  const users = createUsersRepository(pool);
  const warehouses = createWarehouseSeedRepository(pool);
  const products = createProductSeedRepository(pool);
  return createDemoDataService({
    catalog: {
      ensureWarehouse: (warehouse) => warehouses.ensureByCode(warehouse),
      ensureProduct: (product) => products.ensureProduct(product),
      hasMovements: (skus) => products.hasMovements(skus),
    },
    stock: deps.stockService,
    transfers: deps.transfersService,
    async findUserId(email) {
      return (await users.findByEmail(email))?.id ?? null;
    },
    addWarehouses: (userId, ids) => users.addWarehouses(userId, ids),
  });
}

async function seedUsers(): Promise<void> {
  const users = createUsersRepository(pool);
  const usersService = createUsersService({ users, hasher: createArgon2Hasher() });
  const warehouses = createWarehouseSeedRepository(pool);
  await createSeedService({
    ensureUser: (user) => usersService.ensureUser(user),
    async findUserId(email) {
      return (await users.findByEmail(email))?.id ?? null;
    },
    ensureWarehouse: (warehouse) => warehouses.ensureByCode(warehouse),
    addWarehouses: (userId, ids) => users.addWarehouses(userId, ids),
  }).run(plan);
}

const run = () => demoService().run({ adminEmail: ADMIN_EMAIL, managerEmail: MANAGER_EMAIL });

async function counts(): Promise<Record<string, number>> {
  const tables = ['warehouses', 'products', 'stock_movements', 'transfers', 'transfer_events'];
  const result: Record<string, number> = {};
  for (const table of tables) {
    const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
    result[table] = Number(rows[0]?.n);
  }
  return result;
}

async function levelOf(code: string, sku: string): Promise<{ quantity: number; avg_cost: string }> {
  const { rows } = await pool.query<{ quantity: number; avg_cost: string }>(
    `SELECT l.quantity, l.avg_cost FROM stock_levels l
     JOIN warehouses w ON w.id = l.warehouse_id JOIN products p ON p.id = l.product_id
     WHERE w.code = $1 AND p.sku = $2`,
    [code, sku],
  );
  const row = rows[0];
  if (!row) throw new Error(`Sin existencias de ${sku} en ${code}`);
  return row;
}

beforeAll(async () => {
  await truncateAll(pool);
  await seedUsers();
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('seed de demo (a través de los servicios)', () => {
  it('siembra un traspaso en cada estado, entradas y mermas, y el libro cuadra', async () => {
    expect(await run()).toBe(true);

    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM transfers ORDER BY status',
    );
    expect(rows.map((r) => r.status)).toEqual([
      'CANCELLED',
      'DISCREPANCY',
      'DRAFT',
      'IN_TRANSIT',
      'RECEIVED',
      'RESOLVED',
    ]);
    const types = await pool.query<{ type: string }>(
      'SELECT DISTINCT type FROM stock_movements ORDER BY type',
    );
    expect(types.rows.map((r) => r.type)).toEqual([
      'ENTRY',
      'SHRINKAGE',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'TRANSIT_SHRINKAGE',
    ]);
    await expectLedgerMatchesLevels(pool);
  });

  it('el CPP y los saldos salen como se calculan a mano', async () => {
    // (500×120 + 300×135) / 800 = 125,625; luego salen 120 y se pierden 6 al mismo costo
    expect(await levelOf('BOD-A', 'TOR-014')).toEqual({ quantity: 674, avg_cost: '125.6250' });
    // B tenía 100 a $130 y recibe 120 a $125,625 → (13000 + 15075) / 220 = 127,6136…
    expect(await levelOf('BOD-B', 'TOR-014')).toEqual({ quantity: 220, avg_cost: '127.6136' });
    // C recibe 195 m de los 200 enviados (5 m como merma en tránsito)
    expect((await levelOf('BOD-C', 'CAB-012')).quantity).toBe(195);
    // C: 30 − 10 en tránsito − 2 de merma
    expect((await levelOf('BOD-C', 'CEM-050')).quantity).toBe(18);
  });

  it('asigna al jefe de bodega las tres bodegas de la demo', async () => {
    const { rows } = await pool.query<{ code: string }>(
      `SELECT w.code FROM user_warehouses uw
       JOIN users u ON u.id = uw.user_id JOIN warehouses w ON w.id = uw.warehouse_id
       WHERE lower(u.email) = $1 ORDER BY w.code`,
      [MANAGER_EMAIL],
    );
    expect(rows.map((r) => r.code)).toEqual(['BOD-A', 'BOD-B', 'BOD-C']);
  });

  it('correrlo otra vez no duplica nada', async () => {
    const before = await counts();
    expect(await run()).toBe(false);
    expect(await counts()).toEqual(before);
    await expectLedgerMatchesLevels(pool);
  });

  it('sin el jefe de bodega sembrado falla con un mensaje claro', async () => {
    await truncateAll(pool);
    await expect(run()).rejects.toThrow('corre antes el seed de usuarios');
  });
});
