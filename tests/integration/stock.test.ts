import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../../src/db';
import { applyEntry, type StockBalance } from '../../src/domain/stock';
import { createStockRepository } from '../../src/repositories/stock';
import { createStockService } from '../../src/services/stock';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { allowAllAccess } from '../helpers/actors';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

let token: string;
let userId: string;
let warehouseId: string;
let productId: string;

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.password });
  token = res.body.accessToken;
  userId = res.body.user.id;
  warehouseId = await insertId(
    'warehouses',
    `INSERT INTO warehouses (code, name) VALUES ('A', 'Bodega A') RETURNING id`,
  );
  productId = await insertId(
    'products',
    `INSERT INTO products (sku, name, unit) VALUES ('SKU-1', 'Tornillo', 'un') RETURNING id`,
  );
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

async function insertId(_table: string, sql: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql);
  const row = rows[0];
  if (!row) throw new Error('INSERT sin fila');
  return row.id;
}

function auth(): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function entry(quantity: number, unitCost: string): Record<string, unknown> {
  return { warehouseId, productId, quantity, unitCost };
}

async function level(): Promise<
  { quantity: number; avg_cost: string; version: number } | undefined
> {
  const { rows } = await pool.query<{ quantity: number; avg_cost: string; version: number }>(
    'SELECT quantity, avg_cost, version FROM stock_levels WHERE product_id = $1 AND warehouse_id = $2',
    [productId, warehouseId],
  );
  return rows[0];
}

async function count(table: 'stock_levels' | 'stock_movements'): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

describe('POST /api/stock/entries', () => {
  it('10 u a $100 y luego 10 u a $120 dan 20 u a $110 y dos movimientos con su saldo', async () => {
    const first = await request(app).post('/api/stock/entries').set(auth()).send(entry(10, '100'));
    expect(first.status).toBe(201);
    expect(first.body.stockLevel).toMatchObject({
      productId,
      warehouseId,
      quantity: 10,
      avgCost: '100.0000',
      totalValue: '1000.0000',
    });
    expect(first.body.movement).toMatchObject({
      type: 'ENTRY',
      quantity: 10,
      unitCost: '100.0000',
      balanceQty: 10,
      balanceAvgCost: '100.0000',
      createdBy: userId,
    });

    const second = await request(app).post('/api/stock/entries').set(auth()).send(entry(10, '120'));
    expect(second.status).toBe(201);
    expect(second.body.stockLevel).toMatchObject({
      quantity: 20,
      avgCost: '110.0000',
      totalValue: '2200.0000',
    });
    expect(second.body.movement).toMatchObject({ balanceQty: 20, balanceAvgCost: '110.0000' });
    expect(await count('stock_movements')).toBe(2);
  });

  it('sin token da 401 y no guarda nada', async () => {
    const res = await request(app).post('/api/stock/entries').send(entry(10, '100'));
    expect(res.status).toBe(401);
    expect(await count('stock_movements')).toBe(0);
  });

  it.each([
    ['cantidad 0', entry(0, '100')],
    ['cantidad negativa', entry(-1, '100')],
    ['costo 0', entry(1, '0')],
    ['costo como número', { warehouseId: 'x', productId: 'y', quantity: 1, unitCost: 100 }],
    ['cuerpo vacío', {}],
  ])('%s da 400 con el formato de error y no guarda nada', async (_name, body) => {
    const res = await request(app).post('/api/stock/entries').set(auth()).send(body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(typeof res.body.correlationId).toBe('string');
    expect(await count('stock_levels')).toBe(0);
    expect(await count('stock_movements')).toBe(0);
  });

  it('una bodega inexistente da 404 y no deja un nivel a medias', async () => {
    const res = await request(app)
      .post('/api/stock/entries')
      .set(auth())
      .send({ ...entry(1, '10'), warehouseId: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('La bodega no existe');
    expect(await count('stock_levels')).toBe(0);
  });

  it('un producto inexistente da 404', async () => {
    const res = await request(app)
      .post('/api/stock/entries')
      .set(auth())
      .send({ ...entry(1, '10'), productId: '99999999-9999-4999-8999-999999999999' });
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('El producto no existe');
  });
});

describe('atomicidad', () => {
  it('si falla el insert del movimiento, el nivel tampoco cambia (rollback)', async () => {
    await request(app).post('/api/stock/entries').set(auth()).send(entry(10, '100'));

    const failing = createStockService({
      access: allowAllAccess,
      runInTransaction: (work) =>
        withTransaction(pool, (client) =>
          work({
            ...createStockRepository(client),
            insertMovement: async () => {
              throw new Error('fallo simulado');
            },
          }),
        ),
    });

    await expect(
      failing.registerEntry(
        { warehouseId, productId, quantity: 5, unitCost: '500' },
        { userId, role: 'ADMIN' },
      ),
    ).rejects.toThrow('fallo simulado');

    expect(await level()).toMatchObject({ quantity: 10, avg_cost: '100.0000', version: 1 });
    expect(await count('stock_movements')).toBe(1);
  });

  it('una primera entrada que falla no deja ni el nivel en cero', async () => {
    const failing = createStockService({
      access: allowAllAccess,
      runInTransaction: (work) =>
        withTransaction(pool, (client) =>
          work({
            ...createStockRepository(client),
            insertMovement: async () => {
              throw new Error('fallo simulado');
            },
          }),
        ),
    });
    await expect(
      failing.registerEntry(
        { warehouseId, productId, quantity: 5, unitCost: '5' },
        { userId, role: 'ADMIN' },
      ),
    ).rejects.toThrow('fallo simulado');
    expect(await count('stock_levels')).toBe(0);
  });
});

describe('concurrencia', () => {
  it('20 entradas en paralelo sobre el mismo producto y bodega suman todo y dejan el CPP correcto', async () => {
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(app).post('/api/stock/entries').set(auth()).send(entry(5, '10')),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(20).fill(201));

    expect(await level()).toMatchObject({ quantity: 100, avg_cost: '10.0000', version: 20 });
    const { rows } = await pool.query<{ total: string; n: string }>(
      'SELECT sum(quantity) AS total, count(*) AS n FROM stock_movements',
    );
    expect(Number(rows[0]?.total)).toBe(100);
    expect(Number(rows[0]?.n)).toBe(20);
  });

  it('con costos distintos, cada movimiento se calculó sobre el saldo anterior (el libro se puede reproducir)', async () => {
    const costs = ['100', '120', '95.5', '210', '99.9999', '150', '80', '300', '10.25', '77'];
    const responses = await Promise.all(
      costs.map((cost, i) =>
        request(app)
          .post('/api/stock/entries')
          .set(auth())
          .send(entry(i + 1, cost)),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual(Array(costs.length).fill(201));

    const { rows } = await pool.query<{
      quantity: number;
      unit_cost: string;
      balance_qty: number;
      balance_avg_cost: string;
    }>(
      'SELECT quantity, unit_cost, balance_qty, balance_avg_cost FROM stock_movements ORDER BY id',
    );
    let balance: StockBalance = { quantity: 0, avgCost: '0.0000' };
    for (const row of rows) {
      balance = applyEntry(balance, { quantity: row.quantity, unitCost: row.unit_cost });
      expect({ quantity: row.balance_qty, avgCost: row.balance_avg_cost }).toEqual(balance);
    }

    const final = await level();
    expect(final).toMatchObject({ quantity: balance.quantity, avg_cost: balance.avgCost });
    expect(balance.quantity).toBe(55);
  });

  it('entradas en paralelo sobre bodegas distintas no se mezclan', async () => {
    const otherWarehouse = await insertId(
      'warehouses',
      `INSERT INTO warehouses (code, name) VALUES ('B', 'Bodega B') RETURNING id`,
    );
    await Promise.all([
      ...Array.from({ length: 5 }, () =>
        request(app).post('/api/stock/entries').set(auth()).send(entry(2, '10')),
      ),
      ...Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/stock/entries')
          .set(auth())
          .send({ ...entry(3, '20'), warehouseId: otherWarehouse }),
      ),
    ]);
    const { rows } = await pool.query<{ warehouse_id: string; quantity: number; avg_cost: string }>(
      'SELECT warehouse_id, quantity, avg_cost FROM stock_levels',
    );
    const byWarehouse = Object.fromEntries(rows.map((r) => [r.warehouse_id, r]));
    expect(byWarehouse[warehouseId]).toMatchObject({ quantity: 10, avg_cost: '10.0000' });
    expect(byWarehouse[otherWarehouse]).toMatchObject({ quantity: 15, avg_cost: '20.0000' });
  });
});

describe('libro de movimientos inmutable', () => {
  it('la BD rechaza UPDATE y DELETE sobre stock_movements', async () => {
    await request(app).post('/api/stock/entries').set(auth()).send(entry(10, '100'));
    await expect(pool.query('UPDATE stock_movements SET quantity = 99')).rejects.toThrow(
      /inmutable/,
    );
    await expect(pool.query('DELETE FROM stock_movements')).rejects.toThrow(/inmutable/);
    expect(await count('stock_movements')).toBe(1);
  });

  it('la BD rechaza existencias negativas aunque el servicio falle', async () => {
    await request(app).post('/api/stock/entries').set(auth()).send(entry(1, '10'));
    await expect(pool.query('UPDATE stock_levels SET quantity = -1')).rejects.toThrow(
      /stock_levels_quantity_check/,
    );
  });
});
