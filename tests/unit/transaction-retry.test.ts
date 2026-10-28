import { describe, expect, it, vi } from 'vitest';
import { withTransaction, type RetryEvent, type TransactionClient } from '../../src/db';

/** Error como el que lanza pg: lleva el código SQLSTATE en `code`. */
class PgError extends Error {
  constructor(readonly code: string) {
    super(`error ${code}`);
  }
}

/** Pool simulado: cada connect() entrega un cliente nuevo y todos registran sus sentencias. */
function fakePool() {
  const statements: string[] = [];
  const released: (boolean | undefined)[] = [];
  const client: TransactionClient = {
    query: vi.fn(async (sql: string) => {
      statements.push(sql);
    }),
    release: vi.fn((destroy?: boolean) => {
      released.push(destroy);
    }),
  };
  return { pool: { connect: vi.fn(async () => client) }, statements, released };
}

function options() {
  const events: RetryEvent[] = [];
  const delays: number[] = [];
  return {
    events,
    delays,
    options: {
      onRetry: (event: RetryEvent) => events.push(event),
      sleep: async (ms: number) => {
        delays.push(ms);
      },
    },
  };
}

/** Falla `failures` veces con `code` y a la siguiente devuelve 'listo'. */
function flaky(failures: number, code: string) {
  let calls = 0;
  return {
    work: async () => {
      calls++;
      if (calls <= failures) throw new PgError(code);
      return 'listo';
    },
    calls: () => calls,
  };
}

describe('withTransaction: reintentos ante 40001 y 40P01', () => {
  it.each(['40001', '40P01'])('reintenta tras %s y devuelve el resultado', async (code) => {
    const { pool, statements } = fakePool();
    const { options: opts, events } = options();
    const job = flaky(2, code);

    await expect(withTransaction(pool, job.work, opts)).resolves.toBe('listo');

    expect(job.calls()).toBe(3);
    expect(events.map((e) => [e.attempt, e.code])).toEqual([
      [1, code],
      [2, code],
    ]);
    // Cada intento es una transacción completa: los dos fallidos se revierten, el último se confirma
    expect(statements).toEqual(['BEGIN', 'ROLLBACK', 'BEGIN', 'ROLLBACK', 'BEGIN', 'COMMIT']);
  });

  it('se rinde tras 3 reintentos y vuelve a lanzar el error original', async () => {
    const { pool, statements } = fakePool();
    const { options: opts, events } = options();
    const job = flaky(Infinity, '40P01');

    await expect(withTransaction(pool, job.work, opts)).rejects.toMatchObject({ code: '40P01' });

    expect(job.calls()).toBe(4); // el intento inicial y 3 reintentos
    expect(events).toHaveLength(3);
    expect(statements.filter((s) => s === 'COMMIT')).toHaveLength(0);
    expect(statements.filter((s) => s === 'ROLLBACK')).toHaveLength(4);
  });

  it('espera cada vez más (50, 100 y 200 ms más algo de azar)', async () => {
    const { pool } = fakePool();
    const { options: opts, delays } = options();

    await withTransaction(pool, flaky(3, '40001').work, opts);

    expect(delays).toHaveLength(3);
    [50, 100, 200].forEach((base, i) => {
      expect(delays[i]).toBeGreaterThanOrEqual(base);
      expect(delays[i]).toBeLessThan(base * 1.5);
    });
  });

  it.each([
    ['violación de unicidad', new PgError('23505')],
    ['violación de clave foránea', new PgError('23503')],
    ['error de dominio sin código SQL', new Error('regla de negocio')],
  ])('no reintenta otros errores (%s)', async (_caso, error) => {
    const { pool, statements } = fakePool();
    const { options: opts, events, delays } = options();
    const work = vi.fn(async () => {
      throw error;
    });

    await expect(withTransaction(pool, work, opts)).rejects.toBe(error);

    expect(work).toHaveBeenCalledTimes(1);
    expect(events).toEqual([]);
    expect(delays).toEqual([]);
    expect(statements).toEqual(['BEGIN', 'ROLLBACK']);
  });

  it('sin errores no reintenta y confirma una sola vez', async () => {
    const { pool, statements } = fakePool();
    const { options: opts, events } = options();

    await expect(withTransaction(pool, async () => 42, opts)).resolves.toBe(42);

    expect(events).toEqual([]);
    expect(statements).toEqual(['BEGIN', 'COMMIT']);
  });

  it('devuelve la conexión al pool en cada intento', async () => {
    const { pool, released } = fakePool();
    const { options: opts } = options();

    await withTransaction(pool, flaky(2, '40001').work, opts);

    expect(released).toEqual([undefined, undefined, undefined]);
  });
});
