import type { Pool } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';
import { createTestPool, migrateTestDatabase } from '../helpers/db';

const pool: Pool = createTestPool();

async function usersTableExists(): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT to_regclass('public.users') IS NOT NULL AS exists`,
  );
  return rows[0]?.exists === true;
}

afterAll(async () => {
  await migrateTestDatabase('up'); // deja el esquema al día para el resto de pruebas
  await pool.end();
});

describe('migraciones', () => {
  it('se pueden revertir por completo y volver a aplicar desde cero', async () => {
    await migrateTestDatabase('down');
    expect(await usersTableExists()).toBe(false);

    await migrateTestDatabase('up');
    expect(await usersTableExists()).toBe(true);
  });

  it('la tabla users rechaza un rol fuera de los cuatro definidos', async () => {
    await expect(
      pool.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ('r@example.com', 'h', 'R', 'SUPERMAN')`,
      ),
    ).rejects.toThrow(/users_role_check/);
  });
});
