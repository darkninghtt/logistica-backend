import type { Pool } from 'pg';
import { z } from 'zod';
import { createPool, createTransactionRunner } from './db';
import { createProductSeedRepository } from './repositories/products';
import { createStockRepository } from './repositories/stock';
import {
  createTransfersReadRepository,
  createTransfersWriteRepository,
} from './repositories/transfers';
import { createUsersRepository } from './repositories/users';
import { createWarehouseSeedRepository } from './repositories/warehouses';
import { buildSeedPlan } from './seed-plan';
import { createDemoDataService } from './services/demo-data';
import { createArgon2Hasher } from './services/password-hasher';
import { createSeedService } from './services/seed';
import { createStockService } from './services/stock';
import { createTransfersService } from './services/transfers';
import { createUsersService } from './services/users';
import { createWarehouseAccess } from './services/warehouse-access';

/**
 * `npm run seed`: crea el ADMIN y, si sus variables están definidas, el jefe de bodega, el
 * operario y el auditor, con bodegas de ejemplo. Es idempotente: se puede correr varias veces.
 *
 * `npm run seed:demo`: además siembra datos de demo (productos, entradas, un traspaso en cada
 * estado y mermas) a través de los servicios. Necesita el jefe de bodega. Si la demo ya se sembró,
 * no repite nada.
 */
async function main(): Promise<void> {
  const { DATABASE_URL } = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env);
  const plan = buildSeedPlan(process.env);
  const withDemo = process.argv.includes('--demo');
  const pool = createPool(DATABASE_URL);
  try {
    const users = createUsersRepository(pool);
    const usersService = createUsersService({ users, hasher: createArgon2Hasher() });
    const warehouses = createWarehouseSeedRepository(pool);
    const seed = createSeedService({
      ensureUser: (user) => usersService.ensureUser(user),
      async findUserId(email) {
        return (await users.findByEmail(email))?.id ?? null;
      },
      ensureWarehouse: (warehouse) => warehouses.ensureByCode(warehouse),
      addWarehouses: (userId, ids) => users.addWarehouses(userId, ids),
    });

    const { createdUsers, existingUsers } = await seed.run(plan);
    for (const email of createdUsers) process.stdout.write(`Usuario creado: ${email}\n`);
    for (const email of existingUsers) process.stdout.write(`El usuario ya existía: ${email}\n`);

    if (withDemo) {
      const manager = plan.users.find((user) => user.role === 'WAREHOUSE_MANAGER');
      const admin = plan.users.find((user) => user.role === 'ADMIN');
      if (!manager || !admin) {
        throw new Error('La demo necesita SEED_MANAGER_EMAIL y SEED_MANAGER_PASSWORD');
      }
      const created = await seedDemoData(pool).run({
        adminEmail: admin.email,
        managerEmail: manager.email,
      });
      process.stdout.write(
        created
          ? 'Datos de demo sembrados.\n'
          : 'Los datos de demo ya estaban: no se repitió nada.\n',
      );
    }
  } finally {
    await pool.end();
  }
}

/** Compone los servicios de stock y de traspasos como main.ts (sin avisos de tiempo real). */
function seedDemoData(pool: Pool): ReturnType<typeof createDemoDataService> {
  const users = createUsersRepository(pool);
  const runInTransaction = createTransactionRunner(pool);
  const access = createWarehouseAccess({
    assignments: { warehouseIdsOf: (userId) => users.warehouseIdsOf(userId) },
  });
  const warehouses = createWarehouseSeedRepository(pool);
  const products = createProductSeedRepository(pool);
  return createDemoDataService({
    catalog: {
      ensureWarehouse: (warehouse) => warehouses.ensureByCode(warehouse),
      ensureProduct: (product) => products.ensureProduct(product),
      hasMovements: (skus) => products.hasMovements(skus),
    },
    stock: createStockService({
      access,
      runInTransaction: (work) => runInTransaction((client) => work(createStockRepository(client))),
    }),
    transfers: createTransfersService({
      store: createTransfersReadRepository(pool),
      access,
      runInTransaction: (work) =>
        runInTransaction((client) =>
          work({
            transfers: createTransfersWriteRepository(client),
            stock: createStockRepository(client),
          }),
        ),
    }),
    async findUserId(email) {
      return (await users.findByEmail(email))?.id ?? null;
    },
    addWarehouses: (userId, ids) => users.addWarehouses(userId, ids),
  });
}

main().catch((err: unknown) => {
  process.stderr.write(`No se pudo sembrar: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
