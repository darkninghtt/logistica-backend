import { z } from 'zod';
import { createPool } from './db';
import { createUsersRepository } from './repositories/users';
import { createArgon2Hasher } from './services/password-hasher';
import { createUsersService } from './services/users';

const seedEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SEED_ADMIN_EMAIL: z.string().email(),
  SEED_ADMIN_PASSWORD: z.string().min(12, 'debe tener al menos 12 caracteres'),
  SEED_ADMIN_NAME: z.string().min(1).default('Administrador'),
});

/** `npm run seed`: crea el usuario ADMIN de desarrollo si no existe (es idempotente). */
async function main(): Promise<void> {
  const env = seedEnvSchema.parse(process.env);
  const pool = createPool(env.DATABASE_URL);
  try {
    const service = createUsersService({
      users: createUsersRepository(pool),
      hasher: createArgon2Hasher(),
    });
    const created = await service.ensureAdmin({
      email: env.SEED_ADMIN_EMAIL,
      password: env.SEED_ADMIN_PASSWORD,
      name: env.SEED_ADMIN_NAME,
    });
    process.stdout.write(
      created
        ? `ADMIN creado: ${env.SEED_ADMIN_EMAIL}\n`
        : `El ADMIN ya existía: ${env.SEED_ADMIN_EMAIL}\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `No se pudo crear el ADMIN: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
});
