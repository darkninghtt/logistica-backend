import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

type RoleName = 'ADMIN' | 'WAREHOUSE_MANAGER' | 'OPERATOR' | 'AUDITOR';

const tokens: Partial<Record<RoleName, string>> = {};
let warehouseA: string;
let warehouseB: string;
let productId: string;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken;
}

function as(role: RoleName): { Authorization: string } {
  return { Authorization: `Bearer ${tokens[role] ?? ''}` };
}

async function createUser(role: Exclude<RoleName, 'ADMIN'>, warehouseIds: string[]): Promise<void> {
  const email = `${role.toLowerCase()}@example.com`;
  const created = await request(app)
    .post('/api/users')
    .set(as('ADMIN'))
    .send({ email, name: role, role, password: PASSWORD });
  expect(created.status).toBe(201);
  const assigned = await request(app)
    .put(`/api/users/${created.body.id}/warehouses`)
    .set(as('ADMIN'))
    .send({ warehouseIds });
  expect(assigned.status).toBe(200);
  tokens[role] = await login(email, PASSWORD);
}

async function entry(warehouseId: string, quantity: number, unitCost: string): Promise<void> {
  const res = await request(app)
    .post('/api/stock/entries')
    .set(as('ADMIN'))
    .send({ warehouseId, productId, quantity, unitCost });
  expect(res.status).toBe(201);
}

function shrinkage(
  quantity: number,
  extra: Record<string, unknown> = {},
  warehouseId = warehouseA,
): Record<string, unknown> {
  return { warehouseId, productId, quantity, reason: 'DAMAGE', ...extra };
}

interface LevelRow {
  quantity: number;
  avg_cost: string;
}

async function level(warehouseId = warehouseA): Promise<LevelRow | undefined> {
  const { rows } = await pool.query<LevelRow>(
    'SELECT quantity, avg_cost FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2',
    [productId, warehouseId],
  );
  return rows[0];
}

async function count(table: 'stock_levels' | 'stock_movements'): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

/**
 * El libro cuadra con stock_levels: las entradas suman, las mermas restan, y el saldo que guarda
 * cada fila es el del movimiento anterior más o menos su cantidad (en el orden en que se bloqueó).
 */
async function expectLedgerMatchesLevels(): Promise<void> {
  const { rows } = await pool.query<{
    product_id: string;
    warehouse_id: string;
    type: string;
    quantity: number;
    balance_qty: number;
  }>(
    'SELECT product_id, warehouse_id, type, quantity, balance_qty FROM stock_movements ORDER BY id',
  );
  const replayed = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.product_id}|${row.warehouse_id}`;
    const signed = row.type === 'SHRINKAGE' ? -row.quantity : row.quantity;
    const balance = (replayed.get(key) ?? 0) + signed;
    expect(row.balance_qty).toBe(balance);
    replayed.set(key, balance);
  }

  const levels = await pool.query<{ product_id: string; warehouse_id: string; quantity: number }>(
    'SELECT product_id, warehouse_id, quantity FROM stock_levels',
  );
  for (const row of levels.rows) {
    expect(row.quantity).toBeGreaterThanOrEqual(0);
    expect(row.quantity).toBe(replayed.get(`${row.product_id}|${row.warehouse_id}`) ?? 0);
  }
}

// Escenario: A tiene 20 u a $110 (10 a $100 y 10 a $120); B tiene 5 u; el jefe y el operario solo
// tienen asignada la A; el auditor ninguna.
beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  tokens.ADMIN = await login(ADMIN.email, ADMIN.password);

  warehouseA = (
    await request(app)
      .post('/api/warehouses')
      .set(as('ADMIN'))
      .send({ code: 'A', name: 'Bodega A' })
  ).body.id;
  warehouseB = (
    await request(app)
      .post('/api/warehouses')
      .set(as('ADMIN'))
      .send({ code: 'B', name: 'Bodega B' })
  ).body.id;
  productId = (
    await request(app)
      .post('/api/products')
      .set(as('ADMIN'))
      .send({ sku: 'SKU-1', name: 'Tornillo', unit: 'un' })
  ).body.id;

  await createUser('WAREHOUSE_MANAGER', [warehouseA]);
  await createUser('OPERATOR', [warehouseA]);
  await createUser('AUDITOR', []);

  await entry(warehouseA, 10, '100');
  await entry(warehouseA, 10, '120');
  await entry(warehouseB, 5, '50');
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('POST /api/stock/shrinkage', () => {
  it('descuenta el stock, valora al costo vigente, deja el movimiento SHRINKAGE y no cambia el CPP', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(2));

    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({
      type: 'SHRINKAGE',
      productId,
      warehouseId: warehouseA,
      quantity: 2,
      unitCost: '110.0000',
      balanceQty: 18,
      balanceAvgCost: '110.0000',
      reason: 'DAMAGE',
      transferId: null,
    });
    expect(res.body.stockLevel).toMatchObject({
      quantity: 18,
      avgCost: '110.0000',
      totalValue: '1980.0000',
    });
    expect(await level()).toEqual({ quantity: 18, avg_cost: '110.0000' });
    expect(await count('stock_movements')).toBe(4);
    await expectLedgerMatchesLevels();
  });

  it('la nota queda junto al motivo en el movimiento', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(1, { reason: 'EXPIRED', note: 'Lote vencido' }));

    expect(res.status).toBe(201);
    expect(res.body.movement.reason).toBe('EXPIRED: Lote vencido');
  });

  it.each(['DAMAGE', 'EXPIRED', 'THEFT', 'COUNT_ADJUSTMENT'])(
    'acepta el motivo %s',
    async (reason) => {
      const res = await request(app)
        .post('/api/stock/shrinkage')
        .set(as('WAREHOUSE_MANAGER'))
        .send(shrinkage(1, { reason }));
      expect(res.status).toBe(201);
      expect(res.body.movement.reason).toBe(reason);
    },
  );

  it('una entrada posterior recalcula el CPP sobre el saldo que dejó la merma', async () => {
    await request(app).post('/api/stock/shrinkage').set(as('WAREHOUSE_MANAGER')).send(shrinkage(2));

    await entry(warehouseA, 10, '130');

    // (18 × 110 + 10 × 130) / 28 = 117.1429
    expect(await level()).toEqual({ quantity: 28, avg_cost: '117.1429' });
  });

  it('se puede mermar todo el stock y queda en cero', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(20));
    expect(res.status).toBe(201);
    expect(await level()).toEqual({ quantity: 0, avg_cost: '110.0000' });
  });

  it('mermar más de lo disponible da 409 INSUFFICIENT_STOCK y no cambia nada', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(21));

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    expect(typeof res.body.correlationId).toBe('string');
    expect(await level()).toEqual({ quantity: 20, avg_cost: '110.0000' });
    expect(await count('stock_movements')).toBe(3);
  });

  it('mermar un producto sin existencias en la bodega da 409 y no deja un nivel en cero', async () => {
    const other = (
      await request(app)
        .post('/api/products')
        .set(as('ADMIN'))
        .send({ sku: 'SKU-2', name: 'Tuerca', unit: 'un' })
    ).body.id;
    const levelsBefore = await count('stock_levels');

    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send({ ...shrinkage(1), productId: other });

    expect(res.status).toBe(409);
    expect(await count('stock_levels')).toBe(levelsBefore);
    expect(await count('stock_movements')).toBe(3);
  });

  it('un producto inexistente da 404 y no guarda nada', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send({ ...shrinkage(1), productId: MISSING_ID });

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('El producto no existe');
    expect(await count('stock_movements')).toBe(3);
  });

  it.each([
    ['cantidad 0', shrinkage(0)],
    ['cantidad negativa', shrinkage(-1)],
    ['cantidad decimal', shrinkage(1.5)],
    ['motivo inválido', shrinkage(1, { reason: 'LOST' })],
    ['sin motivo', shrinkage(1, { reason: undefined })],
    ['nota demasiado larga', shrinkage(1, { note: 'a'.repeat(501) })],
    ['cuerpo vacío', {}],
  ])('%s da 400 con el formato de error y no guarda nada', async (_name, body) => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(typeof res.body.correlationId).toBe('string');
    expect(await level()).toEqual({ quantity: 20, avg_cost: '110.0000' });
    expect(await count('stock_movements')).toBe(3);
  });

  it('la merma aparece en el historial de la bodega con su motivo', async () => {
    await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(2, { reason: 'THEFT' }));

    const res = await request(app)
      .get('/api/stock/movements')
      .query({ warehouseId: warehouseA })
      .set(as('WAREHOUSE_MANAGER'));

    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ type: 'SHRINKAGE', reason: 'THEFT', quantity: 2 });
  });
});

describe('POST /api/stock/shrinkage: autorización', () => {
  it('sin token da 401 y no guarda nada', async () => {
    const res = await request(app).post('/api/stock/shrinkage').send(shrinkage(1));
    expect(res.status).toBe(401);
    expect(await count('stock_movements')).toBe(3);
  });

  it('WAREHOUSE_MANAGER registra una merma en su bodega asignada', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(1));
    expect(res.status).toBe(201);
  });

  it('OPERATOR registra una merma en su bodega asignada, sin recibir campos de costo', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('OPERATOR'))
      .send(shrinkage(1));

    expect(res.status).toBe(201);
    expect(res.body.movement).toMatchObject({ type: 'SHRINKAGE', quantity: 1, balanceQty: 19 });
    expect(res.body.stockLevel).toMatchObject({ quantity: 19 });
    const json = JSON.stringify(res.body);
    for (const field of ['avgCost', 'totalValue', 'unitCost', 'balanceAvgCost']) {
      expect(json).not.toContain(field);
    }
    // El costo sí quedó en el libro: solo se oculta en la respuesta
    expect(await level()).toEqual({ quantity: 19, avg_cost: '110.0000' });
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR'] as const)(
    '%s recibe 403 en una bodega ajena y no cambia el stock',
    async (role) => {
      const res = await request(app)
        .post('/api/stock/shrinkage')
        .set(as(role))
        .send(shrinkage(1, {}, warehouseB));

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
      expect(await level(warehouseB)).toEqual({ quantity: 5, avg_cost: '50.0000' });
      expect(await count('stock_movements')).toBe(3);
    },
  );

  it('WAREHOUSE_MANAGER recibe 403 (no 404) para una bodega que no existe', async () => {
    const res = await request(app)
      .post('/api/stock/shrinkage')
      .set(as('WAREHOUSE_MANAGER'))
      .send(shrinkage(1, {}, MISSING_ID));
    expect(res.status).toBe(403);
  });

  it.each(['ADMIN', 'AUDITOR'] as const)(
    '%s recibe 403 aunque la bodega exista y tenga stock',
    async (role) => {
      const res = await request(app).post('/api/stock/shrinkage').set(as(role)).send(shrinkage(1));

      expect(res.status).toBe(403);
      expect(await level()).toEqual({ quantity: 20, avg_cost: '110.0000' });
      expect(await count('stock_movements')).toBe(3);
    },
  );
});

describe('mermas: concurrencia', () => {
  it('25 mermas de 1 u en paralelo sobre 20 u: caben 20, el resto da 409 y el stock no baja de cero', async () => {
    const responses = await Promise.all(
      Array.from({ length: 25 }, () =>
        request(app).post('/api/stock/shrinkage').set(as('WAREHOUSE_MANAGER')).send(shrinkage(1)),
      ),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(20);
    expect(statuses.filter((s) => s === 409)).toHaveLength(5);
    expect(statuses.every((s) => s === 201 || s === 409)).toBe(true);
    for (const res of responses.filter((r) => r.status === 409)) {
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    }

    expect(await level()).toEqual({ quantity: 0, avg_cost: '110.0000' });
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM stock_movements WHERE type = 'SHRINKAGE'`,
    );
    expect(Number(rows[0]?.n)).toBe(20);
    await expectLedgerMatchesLevels();
  });

  it('12 mermas de 3 u en paralelo sobre 20 u: se aplican 6 (18 u) y quedan 2', async () => {
    const responses = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        request(app)
          .post('/api/stock/shrinkage')
          .set(as(i % 2 === 0 ? 'WAREHOUSE_MANAGER' : 'OPERATOR'))
          .send(shrinkage(3)),
      ),
    );

    const ok = responses.filter((r) => r.status === 201);
    expect(ok).toHaveLength(6);
    expect(responses.filter((r) => r.status === 409)).toHaveLength(6);
    expect(await level()).toEqual({ quantity: 2, avg_cost: '110.0000' });
    await expectLedgerMatchesLevels();
  });

  it('mermas y entradas mezcladas en paralelo: el stock nunca es negativo y el libro cuadra', async () => {
    const calls = [
      ...Array.from({ length: 15 }, () =>
        request(app).post('/api/stock/shrinkage').set(as('WAREHOUSE_MANAGER')).send(shrinkage(2)),
      ),
      ...Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/stock/entries')
          .set(as('ADMIN'))
          .send({ warehouseId: warehouseA, productId, quantity: 4, unitCost: '110' }),
      ),
    ];
    const responses = await Promise.all(calls);

    expect(responses.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    const applied = responses.slice(0, 15).filter((r) => r.status === 201).length;
    expect(await level()).toMatchObject({ quantity: 20 + 5 * 4 - applied * 2 });
    await expectLedgerMatchesLevels();
  });

  it('las mermas rechazadas por rol, en paralelo con las aceptadas, no alteran otras bodegas', async () => {
    await entry(warehouseB, 5, '50');
    const responses = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        request(app).post('/api/stock/shrinkage').set(as('WAREHOUSE_MANAGER')).send(shrinkage(1)),
      ),
      ...Array.from({ length: 6 }, () =>
        request(app)
          .post('/api/stock/shrinkage')
          .set(as('ADMIN'))
          .send(shrinkage(1, {}, warehouseB)),
      ),
    ]);

    // El ADMIN no puede mermar (403); solo cuentan las 6 de la bodega A
    expect(responses.slice(0, 6).map((r) => r.status)).toEqual(Array(6).fill(201));
    expect(responses.slice(6).map((r) => r.status)).toEqual(Array(6).fill(403));
    expect(await level(warehouseA)).toMatchObject({ quantity: 14 });
    expect(await level(warehouseB)).toMatchObject({ quantity: 10 });
    await expectLedgerMatchesLevels();
  });
});

describe('mermas: atomicidad', () => {
  it('la BD rechaza existencias negativas aunque el servicio falle', async () => {
    await expect(
      pool.query('UPDATE stock_levels SET quantity = -1 WHERE warehouse_id = $1', [warehouseA]),
    ).rejects.toThrow(/stock_levels_quantity_check/);
  });

  it('el movimiento de merma no se puede modificar ni borrar', async () => {
    await request(app).post('/api/stock/shrinkage').set(as('WAREHOUSE_MANAGER')).send(shrinkage(1));
    await expect(
      pool.query(`UPDATE stock_movements SET quantity = 99 WHERE type = 'SHRINKAGE'`),
    ).rejects.toThrow(/inmutable/);
    await expect(
      pool.query(`DELETE FROM stock_movements WHERE type = 'SHRINKAGE'`),
    ).rejects.toThrow(/inmutable/);
  });
});
