import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const MISSING_ID = '0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11';

let token: string;
let warehouseA: string;
let warehouseB: string;
let screws: string;
let nuts: string;

async function insertId(sql: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql);
  const row = rows[0];
  if (!row) throw new Error('INSERT sin fila');
  return row.id;
}

function auth(): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

/** Registra la entrada por la API real: así los datos salen del mismo flujo que usará la interfaz. */
async function enter(
  warehouseId: string,
  productId: string,
  quantity: number,
  unitCost: string,
): Promise<void> {
  const res = await request(app)
    .post('/api/stock/entries')
    .set(auth())
    .send({ warehouseId, productId, quantity, unitCost });
  expect(res.status).toBe(201);
}

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  const login = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.password });
  token = login.body.accessToken;
  warehouseA = await insertId(
    `INSERT INTO warehouses (code, name) VALUES ('A', 'Bodega A') RETURNING id`,
  );
  warehouseB = await insertId(
    `INSERT INTO warehouses (code, name) VALUES ('B', 'Bodega B') RETURNING id`,
  );
  screws = await insertId(
    `INSERT INTO products (sku, name, unit) VALUES ('SKU-1', 'Tornillo', 'un') RETURNING id`,
  );
  nuts = await insertId(
    `INSERT INTO products (sku, name, unit) VALUES ('SKU-2', 'Tuerca', 'un') RETURNING id`,
  );
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('GET /api/stock', () => {
  it('devuelve cantidad, costo promedio y valor total (10 u a $100 + 10 u a $120 = 20 u a $110)', async () => {
    await enter(warehouseA, screws, 10, '100');
    await enter(warehouseA, screws, 10, '120');

    const res = await request(app).get(`/api/stock?warehouseId=${warehouseA}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 1 });
    expect(res.body.data).toEqual([
      {
        productId: screws,
        warehouseId: warehouseA,
        quantity: 20,
        avgCost: '110.0000',
        totalValue: '2200.0000',
        productSku: 'SKU-1',
        productName: 'Tornillo',
        productUnit: 'un',
      },
    ]);
  });

  it('el valor total es cantidad × costo promedio con decimales exactos', async () => {
    await enter(warehouseA, screws, 3, '10.3333');

    const res = await request(app).get(`/api/stock?warehouseId=${warehouseA}`).set(auth());

    expect(res.body.data[0]).toMatchObject({ avgCost: '10.3333', totalValue: '30.9999' });
  });

  it('solo muestra las existencias de la bodega pedida', async () => {
    await enter(warehouseA, screws, 5, '10');
    await enter(warehouseB, nuts, 7, '20');

    const res = await request(app).get(`/api/stock?warehouseId=${warehouseB}`).set(auth());

    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ productSku: 'SKU-2', quantity: 7 });
  });

  it('una bodega sin movimientos devuelve la lista vacía', async () => {
    const res = await request(app).get(`/api/stock?warehouseId=${warehouseB}`).set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  it('pagina y ordena por SKU', async () => {
    await enter(warehouseA, nuts, 1, '5');
    await enter(warehouseA, screws, 1, '5');

    const first = await request(app)
      .get(`/api/stock?warehouseId=${warehouseA}&page=1&pageSize=1`)
      .set(auth());
    const second = await request(app)
      .get(`/api/stock?warehouseId=${warehouseA}&page=2&pageSize=1`)
      .set(auth());

    expect(first.body.total).toBe(2);
    expect(first.body.data.map((l: { productSku: string }) => l.productSku)).toEqual(['SKU-1']);
    expect(second.body.data.map((l: { productSku: string }) => l.productSku)).toEqual(['SKU-2']);
  });

  it('una bodega inexistente da 404', async () => {
    const res = await request(app).get(`/api/stock?warehouseId=${MISSING_ID}`).set(auth());

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect(res.body.message).toBe('La bodega no existe');
  });

  it('sin warehouseId o con uno inválido da 400', async () => {
    const missing = await request(app).get('/api/stock').set(auth());
    const invalid = await request(app).get('/api/stock?warehouseId=123').set(auth());

    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('VALIDATION_ERROR');
    expect(invalid.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app).get(`/api/stock?warehouseId=${warehouseA}`);
    expect(res.status).toBe(401);
  });
});

describe('GET /api/stock/movements', () => {
  it('devuelve el historial con el saldo y el costo después de cada movimiento, del más nuevo al más antiguo', async () => {
    await enter(warehouseA, screws, 10, '100');
    await enter(warehouseA, screws, 10, '120');

    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    const [latest, oldest] = res.body.data;
    expect(latest).toMatchObject({
      type: 'ENTRY',
      quantity: 10,
      unitCost: '120.0000',
      balanceQty: 20,
      balanceAvgCost: '110.0000',
      productSku: 'SKU-1',
      productName: 'Tornillo',
    });
    expect(oldest).toMatchObject({
      quantity: 10,
      unitCost: '100.0000',
      balanceQty: 10,
      balanceAvgCost: '100.0000',
    });
  });

  it('filtra por producto', async () => {
    await enter(warehouseA, screws, 5, '10');
    await enter(warehouseA, nuts, 3, '20');

    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}&productId=${nuts}`)
      .set(auth());

    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ productSku: 'SKU-2', quantity: 3 });
  });

  it('solo muestra los movimientos de la bodega pedida', async () => {
    await enter(warehouseA, screws, 5, '10');
    await enter(warehouseB, screws, 9, '10');

    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseB}`)
      .set(auth());

    expect(res.body.total).toBe(1);
    expect(res.body.data[0]).toMatchObject({ quantity: 9, warehouseId: warehouseB });
  });

  it('pagina el historial', async () => {
    for (const cost of ['10', '20', '30']) {
      await enter(warehouseA, screws, 1, cost);
    }

    const first = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}&page=1&pageSize=2`)
      .set(auth());
    const second = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}&page=2&pageSize=2`)
      .set(auth());

    expect(first.body.total).toBe(3);
    expect(first.body.data.map((m: { unitCost: string }) => m.unitCost)).toEqual([
      '30.0000',
      '20.0000',
    ]);
    expect(second.body.data.map((m: { unitCost: string }) => m.unitCost)).toEqual(['10.0000']);
  });

  it('sin movimientos devuelve la lista vacía', async () => {
    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  it('una bodega inexistente da 404', async () => {
    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${MISSING_ID}`)
      .set(auth());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('La bodega no existe');
  });

  it('un producto inexistente da 404', async () => {
    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}&productId=${MISSING_ID}`)
      .set(auth());

    expect(res.status).toBe(404);
    expect(res.body.message).toBe('El producto no existe');
  });

  it('parámetros inválidos dan 400', async () => {
    const noWarehouse = await request(app).get('/api/stock/movements').set(auth());
    const badProduct = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}&productId=abc`)
      .set(auth());
    const badPage = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}&page=0`)
      .set(auth());

    expect(noWarehouse.status).toBe(400);
    expect(badProduct.status).toBe(400);
    expect(badPage.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app).get(`/api/stock/movements?warehouseId=${warehouseA}`);
    expect(res.status).toBe(401);
  });
});

describe('documentación', () => {
  it('Swagger documenta las consultas de stock', async () => {
    const res = await request(app).get('/api-docs.json');

    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/stock', '/api/stock/movements', '/api/stock/entries']),
    );
  });
});
