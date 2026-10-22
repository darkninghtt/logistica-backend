import { z } from 'zod';
import { createPool } from './db';
import { createUsersRepository } from './repositories/users';
import { createWarehouseSeedRepository } from './repositories/warehouses';
import { buildSeedPlan } from './seed-plan';
import { createArgon2Hasher } from './services/password-hasher';
import { createSeedService } from './services/seed';
import { createUsersService } from './services/users';

/**
 * `npm run seed`: crea el ADMIN y, si sus variables están definidas, el jefe de bodega, el
 * operario y el auditor, con bodegas de ejemplo. Es idempotente: se puede correr varias veces.
 */
async function main(): Promise<void> {
  const { DATABASE_URL } = z.object({ DATABASE_URL: z.string().min(1) }).parse(process.env);
  const plan = buildSeedPlan(process.env);
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
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`No se pudo sembrar: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
