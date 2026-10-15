import type { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../../src/db';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();

async function countUsers(): Promise<number> {
  const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM users');
  return Number(rows[0]?.count);
}

beforeEach(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('conexión a la BD de pruebas', () => {
  it('responde a una consulta', async () => {
    const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0]?.ok).toBe(1);
  });

  it('empieza cada prueba sin datos', async () => {
    expect(await countUsers()).toBe(0);
  });
});

describe('withTransaction', () => {
  const insertUser = (email: string) => (client: { query: Pool['query'] }) =>
    client.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, 'hash', 'Prueba', 'ADMIN')`,
      [email],
    );

  it('confirma (COMMIT) cuando el trabajo termina bien y devuelve su resultado', async () => {
    const result = await withTransaction(pool, async (client) => {
      await insertUser('ok@example.com')(client);
      return 'listo';
    });
    expect(result).toBe('listo');
    expect(await countUsers()).toBe(1);
  });

  it('revierte (ROLLBACK) todo si el trabajo lanza un error y vuelve a lanzarlo', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await insertUser('a@example.com')(client);
        await insertUser('b@example.com')(client);
        throw new Error('falla a mitad de la transacción');
      }),
    ).rejects.toThrow('falla a mitad de la transacción');
    expect(await countUsers()).toBe(0);
  });

  it('revierte también cuando falla la propia BD (violación de unicidad)', async () => {
    await expect(
      withTransaction(pool, async (client) => {
        await insertUser('dup@example.com')(client);
        await insertUser('DUP@example.com')(client);
      }),
    ).rejects.toThrow(/users_email_key/);
    expect(await countUsers()).toBe(0);
  });

  it('devuelve la conexión al pool tras un error (no se agota)', async () => {
    for (let i = 0; i < 15; i++) {
      await withTransaction(pool, () => Promise.reject(new Error('x'))).catch(() => undefined);
    }
    const { rows } = await pool.query<{ ok: number }>('SELECT 1 AS ok');
    expect(rows[0]?.ok).toBe(1);
    expect(pool.waitingCount).toBe(0);
  });
});
