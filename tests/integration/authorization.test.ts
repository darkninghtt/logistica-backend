import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const COST_FIELDS = ['avgCost', 'totalValue', 'unitCost', 'balanceAvgCost'];

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

function entry(warehouseId: string): {
  warehouseId: string;
  productId: string;
  quantity: number;
  unitCost: string;
} {
  return { warehouseId, productId, quantity: 10, unitCost: '100' };
}

async function stockMovementsCount(): Promise<number> {
  const { rows } = await pool.query<{ n: string }>('SELECT count(*) AS n FROM stock_movements');
  return Number(rows[0]?.n);
}

// Escenario: dos bodegas con stock; el jefe y el operario solo tienen asignada la A; el auditor ninguna
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

  for (const warehouseId of [warehouseA, warehouseB]) {
    const res = await request(app)
      .post('/api/stock/entries')
      .set(as('ADMIN'))
      .send(entry(warehouseId));
    expect(res.status).toBe(201);
  }
});

beforeAll(async () => {
  await truncateAll(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('POST /api/stock/entries', () => {
  it('ADMIN registra entradas en cualquier bodega', async () => {
    for (const warehouseId of [warehouseA, warehouseB]) {
      const res = await request(app)
        .post('/api/stock/entries')
        .set(as('ADMIN'))
        .send(entry(warehouseId));
      expect(res.status).toBe(201);
    }
  });

  it('WAREHOUSE_MANAGER registra en su bodega asignada', async () => {
    const res = await request(app)
      .post('/api/stock/entries')
      .set(as('WAREHOUSE_MANAGER'))
      .send(entry(warehouseA));
    expect(res.status).toBe(201);
    expect(res.body.movement.createdBy).toBeTruthy();
  });

  it('WAREHOUSE_MANAGER es rechazado (403) en una bodega ajena y no cambia el stock', async () => {
    const before = await stockMovementsCount();

    const res = await request(app)
      .post('/api/stock/entries')
      .set(as('WAREHOUSE_MANAGER'))
      .send(entry(warehouseB));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(await stockMovementsCount()).toBe(before);
  });

  it('WAREHOUSE_MANAGER recibe 403 (no 404) para una bodega que no existe', async () => {
    const res = await request(app)
      .post('/api/stock/entries')
      .set(as('WAREHOUSE_MANAGER'))
      .send(entry(MISSING_ID));
    expect(res.status).toBe(403);
  });

  it.each(['OPERATOR', 'AUDITOR'] as const)(
    '%s recibe 403 aunque la bodega sea suya',
    async (role) => {
      const before = await stockMovementsCount();

      const res = await request(app)
        .post('/api/stock/entries')
        .set(as(role))
        .send(entry(warehouseA));

      expect(res.status).toBe(403);
      expect(await stockMovementsCount()).toBe(before);
    },
  );
});

describe('GET /api/stock y /api/stock/movements', () => {
  const levelsUrl = (warehouseId: string): string => `/api/stock?warehouseId=${warehouseId}`;
  const movementsUrl = (warehouseId: string): string =>
    `/api/stock/movements?warehouseId=${warehouseId}`;

  it.each(['ADMIN', 'AUDITOR'] as const)(
    '%s consulta cualquier bodega, con costos',
    async (role) => {
      for (const warehouseId of [warehouseA, warehouseB]) {
        const levels = await request(app).get(levelsUrl(warehouseId)).set(as(role));
        const movements = await request(app).get(movementsUrl(warehouseId)).set(as(role));
        expect(levels.status).toBe(200);
        expect(levels.body.data[0]).toMatchObject({ avgCost: '100.0000', totalValue: '1000.0000' });
        expect(movements.status).toBe(200);
        expect(movements.body.data[0]).toMatchObject({
          unitCost: '100.0000',
          balanceAvgCost: '100.0000',
        });
      }
    },
  );

  it('WAREHOUSE_MANAGER consulta su bodega con costos', async () => {
    const levels = await request(app).get(levelsUrl(warehouseA)).set(as('WAREHOUSE_MANAGER'));
    const movements = await request(app).get(movementsUrl(warehouseA)).set(as('WAREHOUSE_MANAGER'));

    expect(levels.status).toBe(200);
    expect(levels.body.data[0]).toMatchObject({ avgCost: '100.0000', totalValue: '1000.0000' });
    expect(movements.status).toBe(200);
    expect(movements.body.data[0]).toMatchObject({
      unitCost: '100.0000',
      balanceAvgCost: '100.0000',
    });
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR'] as const)(
    '%s recibe 403 en una bodega ajena',
    async (role) => {
      for (const url of [levelsUrl(warehouseB), movementsUrl(warehouseB)]) {
        const res = await request(app).get(url).set(as(role));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }
    },
  );

  it('OPERATOR consulta el stock de su bodega sin ningún campo de costo', async () => {
    const levels = await request(app).get(levelsUrl(warehouseA)).set(as('OPERATOR'));
    const movements = await request(app).get(movementsUrl(warehouseA)).set(as('OPERATOR'));

    expect(levels.status).toBe(200);
    expect(levels.body.data[0]).toMatchObject({
      productSku: 'SKU-1',
      productName: 'Tornillo',
      quantity: 10,
    });
    expect(movements.status).toBe(200);
    expect(movements.body.data[0]).toMatchObject({ type: 'ENTRY', quantity: 10, balanceQty: 10 });
    for (const field of COST_FIELDS) {
      expect(JSON.stringify([levels.body, movements.body])).not.toContain(field);
    }
  });

  it('una bodega inexistente da 404 al ADMIN y 403 a quien no tiene alcance global', async () => {
    const url = levelsUrl(MISSING_ID);
    expect((await request(app).get(url).set(as('ADMIN'))).status).toBe(404);
    expect((await request(app).get(url).set(as('OPERATOR'))).status).toBe(403);
  });
});

describe('GET /api/warehouses', () => {
  it.each(['ADMIN', 'AUDITOR'] as const)('%s ve todas las bodegas', async (role) => {
    const res = await request(app).get('/api/warehouses').set(as(role));
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR'] as const)(
    '%s solo ve las bodegas asignadas',
    async (role) => {
      const res = await request(app).get('/api/warehouses').set(as(role));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data.map((w: { id: string }) => w.id)).toEqual([warehouseA]);
    },
  );

  it('un usuario sin bodegas asignadas ve una lista vacía', async () => {
    const created = await request(app)
      .post('/api/users')
      .set(as('ADMIN'))
      .send({ email: 'sin@example.com', name: 'Sin', role: 'OPERATOR', password: PASSWORD });
    expect(created.status).toBe(201);
    const token = await login('sin@example.com', PASSWORD);
    const res = await request(app)
      .get('/api/warehouses')
      .set({ Authorization: `Bearer ${token}` });
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });
});

describe('crear y editar bodegas y productos: solo ADMIN', () => {
  it('ADMIN crea y edita bodegas y productos', async () => {
    const wh = await request(app)
      .post('/api/warehouses')
      .set(as('ADMIN'))
      .send({ code: 'C', name: 'Bodega C' });
    expect(wh.status).toBe(201);
    const whPut = await request(app)
      .put(`/api/warehouses/${wh.body.id}`)
      .set(as('ADMIN'))
      .send({ code: 'C', name: 'Nuevo', active: true });
    expect(whPut.status).toBe(200);

    const product = await request(app)
      .post('/api/products')
      .set(as('ADMIN'))
      .send({ sku: 'SKU-2', name: 'Tuerca', unit: 'un' });
    expect(product.status).toBe(201);
    const productPut = await request(app)
      .put(`/api/products/${product.body.id}`)
      .set(as('ADMIN'))
      .send({ sku: 'SKU-2', name: 'Tuerca M6', unit: 'un' });
    expect(productPut.status).toBe(200);
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR'] as const)(
    '%s recibe 403 al crear o editar',
    async (role) => {
      const calls = [
        request(app).post('/api/warehouses').set(as(role)).send({ code: 'Z', name: 'Z' }),
        request(app)
          .put(`/api/warehouses/${warehouseA}`)
          .set(as(role))
          .send({ code: 'A', name: 'Cambiada', active: true }),
        request(app).post('/api/products').set(as(role)).send({ sku: 'Z', name: 'Z', unit: 'un' }),
        request(app)
          .put(`/api/products/${productId}`)
          .set(as(role))
          .send({ sku: 'SKU-1', name: 'Cambiado', unit: 'un' }),
      ];
      for (const res of await Promise.all(calls)) {
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
      }

      const { rows } = await pool.query<{ name: string }>(
        'SELECT name FROM warehouses WHERE id = $1',
        [warehouseA],
      );
      expect(rows[0]?.name).toBe('Bodega A');
    },
  );

  it.each(['ADMIN', 'WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR'] as const)(
    '%s puede leer los productos',
    async (role) => {
      const res = await request(app).get('/api/products').set(as(role));
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
    },
  );
});

describe('usuarios: solo ADMIN', () => {
  it('ADMIN lista; el resto recibe 403', async () => {
    expect((await request(app).get('/api/users').set(as('ADMIN'))).status).toBe(200);
    for (const role of ['WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR'] as const) {
      expect((await request(app).get('/api/users').set(as(role))).status).toBe(403);
    }
  });
});
