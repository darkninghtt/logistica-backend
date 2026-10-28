import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

type Who =
  'ADMIN' | 'AUDITOR' | 'MANAGER_A' | 'OPERATOR_A' | 'OPERATOR_A2' | 'MANAGER_B' | 'MANAGER_C';

const tokens: Partial<Record<Who, string>> = {};
let warehouseA: string;
let warehouseB: string;
let warehouseC: string;
let product1: string;
let product2: string;

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken;
}

function as(who: Who): { Authorization: string } {
  return { Authorization: `Bearer ${tokens[who] ?? ''}` };
}

async function createUser(
  who: Exclude<Who, 'ADMIN'>,
  role: 'WAREHOUSE_MANAGER' | 'OPERATOR' | 'AUDITOR',
  warehouseIds: string[],
): Promise<void> {
  const email = `${who.toLowerCase()}@example.com`;
  const created = await request(app)
    .post('/api/users')
    .set(as('ADMIN'))
    .send({ email, name: who, role, password: PASSWORD });
  expect(created.status).toBe(201);
  const assigned = await request(app)
    .put(`/api/users/${created.body.id}/warehouses`)
    .set(as('ADMIN'))
    .send({ warehouseIds });
  expect(assigned.status).toBe(200);
  tokens[who] = await login(email, PASSWORD);
}

async function entry(productId: string, quantity: number, unitCost: string): Promise<void> {
  const res = await request(app)
    .post('/api/stock/entries')
    .set(as('ADMIN'))
    .send({ warehouseId: warehouseA, productId, quantity, unitCost });
  expect(res.status).toBe(201);
}

function draftBody(items = [{ productId: product1, quantity: 8 }]): Record<string, unknown> {
  return { originWarehouseId: warehouseA, destinationWarehouseId: warehouseB, items };
}

async function createDraft(
  who: Who = 'MANAGER_A',
  items = [{ productId: product1, quantity: 8 }],
): Promise<string> {
  const res = await request(app).post('/api/transfers').set(as(who)).send(draftBody(items));
  expect(res.status).toBe(201);
  return res.body.id;
}

interface LevelRow {
  quantity: number;
  avg_cost: string;
}

async function level(warehouseId: string, productId: string): Promise<LevelRow | undefined> {
  const { rows } = await pool.query<LevelRow>(
    'SELECT quantity, avg_cost FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
    [warehouseId, productId],
  );
  return rows[0];
}

async function count(table: 'stock_movements' | 'transfer_events'): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

// Escenario: A tiene 20 u de P1 a $110 (CPP); el jefe y el operario de A, el jefe de B (destino),
// el jefe de C (ajeno) y el auditor. OPERATOR_A2 es otro operario de A que no crea nada.
beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  tokens.ADMIN = await login(ADMIN.email, ADMIN.password);

  const makeWarehouse = async (code: string): Promise<string> =>
    (
      await request(app)
        .post('/api/warehouses')
        .set(as('ADMIN'))
        .send({ code, name: `Bodega ${code}` })
    ).body.id;
  warehouseA = await makeWarehouse('A');
  warehouseB = await makeWarehouse('B');
  warehouseC = await makeWarehouse('C');
  const makeProduct = async (sku: string): Promise<string> =>
    (
      await request(app)
        .post('/api/products')
        .set(as('ADMIN'))
        .send({ sku, name: `Producto ${sku}`, unit: 'un' })
    ).body.id;
  product1 = await makeProduct('SKU-1');
  product2 = await makeProduct('SKU-2');

  await createUser('MANAGER_A', 'WAREHOUSE_MANAGER', [warehouseA]);
  await createUser('OPERATOR_A', 'OPERATOR', [warehouseA]);
  await createUser('OPERATOR_A2', 'OPERATOR', [warehouseA]);
  await createUser('MANAGER_B', 'WAREHOUSE_MANAGER', [warehouseB]);
  await createUser('MANAGER_C', 'WAREHOUSE_MANAGER', [warehouseC]);
  await createUser('AUDITOR', 'AUDITOR', []);

  await entry(product1, 10, '100');
  await entry(product1, 10, '120');
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('POST /api/transfers', () => {
  it('crea un borrador sin mover stock y deja el evento inicial', async () => {
    const movementsBefore = await count('stock_movements');
    const res = await request(app).post('/api/transfers').set(as('MANAGER_A')).send(draftBody());

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      status: 'DRAFT',
      origin: { id: warehouseA, code: 'A' },
      destination: { id: warehouseB, code: 'B' },
    });
    expect(res.body.items).toEqual([
      expect.objectContaining({
        productId: product1,
        productSku: 'SKU-1',
        quantitySent: 8,
        quantityReceived: null,
        unitCost: null,
      }),
    ]);
    expect(res.body.events).toHaveLength(1);
    expect(res.body.events[0]).toMatchObject({
      fromStatus: null,
      toStatus: 'DRAFT',
      actor: { name: 'MANAGER_A' },
    });
    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 20, avg_cost: '110.0000' });
    expect(await count('stock_movements')).toBe(movementsBefore);
  });

  it.each([
    ['origen igual al destino', () => ({ ...draftBody(), destinationWarehouseId: warehouseA })],
    [
      'producto repetido',
      () =>
        draftBody([
          { productId: product1, quantity: 1 },
          { productId: product1, quantity: 2 },
        ]),
    ],
    ['cantidad 0', () => draftBody([{ productId: product1, quantity: 0 }])],
    ['sin ítems', () => draftBody([])],
  ])('rechaza con 400: %s', async (_caso, body) => {
    const res = await request(app).post('/api/transfers').set(as('MANAGER_A')).send(body());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['origen', () => warehouseA, 'La bodega de origen está inactiva'],
    ['destino', () => warehouseB, 'La bodega de destino está inactiva'],
  ])('rechaza con 409 si la bodega de %s está inactiva', async (_caso, warehouse, message) => {
    const id = warehouse();
    const code = id === warehouseA ? 'A' : 'B';
    await request(app)
      .put(`/api/warehouses/${id}`)
      .set(as('ADMIN'))
      .send({ code, name: `Bodega ${code}`, active: false })
      .expect(200);

    const res = await request(app).post('/api/transfers').set(as('MANAGER_A')).send(draftBody());

    expect(res.status).toBe(409);
    expect(res.body.message).toBe(message);
    const { rows } = await pool.query('SELECT 1 FROM transfers');
    expect(rows).toHaveLength(0);
  });

  it('responde 404 si el destino o un producto no existen', async () => {
    const noDestination = await request(app)
      .post('/api/transfers')
      .set(as('MANAGER_A'))
      .send({ ...draftBody(), destinationWarehouseId: MISSING_ID });
    expect(noDestination.status).toBe(404);

    const noProduct = await request(app)
      .post('/api/transfers')
      .set(as('MANAGER_A'))
      .send(draftBody([{ productId: MISSING_ID, quantity: 1 }]));
    expect(noProduct.status).toBe(404);
    const { rows } = await pool.query('SELECT 1 FROM transfers');
    expect(rows).toHaveLength(0);
  });

  it('permite al jefe y al operario del origen', async () => {
    for (const who of ['MANAGER_A', 'OPERATOR_A'] as const) {
      const res = await request(app).post('/api/transfers').set(as(who)).send(draftBody());
      expect(res.status).toBe(201);
    }
  });

  it.each(['MANAGER_B', 'ADMIN', 'AUDITOR'] as const)('niega con 403 a %s', async (who) => {
    const res = await request(app).post('/api/transfers').set(as(who)).send(draftBody());
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('pide autenticación', async () => {
    const res = await request(app).post('/api/transfers').send(draftBody());
    expect(res.status).toBe(401);
  });
});

describe('POST /api/transfers/:id/dispatch', () => {
  it('descuenta el origen al costo vigente, congela el costo y no cambia el CPP', async () => {
    const id = await createDraft();
    const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('IN_TRANSIT');
    expect(res.body.dispatchedBy).toEqual(expect.any(String));
    expect(res.body.items[0]).toMatchObject({ quantitySent: 8, unitCost: '110.0000' });
    expect(res.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'DRAFT',
      'IN_TRANSIT',
    ]);

    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 12, avg_cost: '110.0000' });
    expect(await level(warehouseB, product1)).toBeUndefined();

    const { rows } = await pool.query(
      `SELECT type, quantity, unit_cost, balance_qty, balance_avg_cost, transfer_id
       FROM stock_movements WHERE type = 'TRANSFER_OUT'`,
    );
    expect(rows).toEqual([
      {
        type: 'TRANSFER_OUT',
        quantity: 8,
        unit_cost: '110.0000',
        balance_qty: 12,
        balance_avg_cost: '110.0000',
        transfer_id: id,
      },
    ]);
  });

  it('escribe un TRANSFER_OUT por ítem', async () => {
    await entry(product2, 5, '50');
    const id = await createDraft('MANAGER_A', [
      { productId: product1, quantity: 3 },
      { productId: product2, quantity: 5 },
    ]);
    const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    expect(res.status).toBe(200);
    const { rows } = await pool.query(`SELECT 1 FROM stock_movements WHERE type = 'TRANSFER_OUT'`);
    expect(rows).toHaveLength(2);
    expect(await level(warehouseA, product2)).toMatchObject({ quantity: 0, avg_cost: '50.0000' });
  });

  it('con stock insuficiente responde 409 y no cambia nada', async () => {
    const id = await createDraft('MANAGER_A', [
      { productId: product1, quantity: 5 },
      { productId: product2, quantity: 1 }, // P2 no tiene stock en A
    ]);
    const movements = await count('stock_movements');
    const events = await count('transfer_events');

    const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INSUFFICIENT_STOCK');
    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 20 });
    expect(await count('stock_movements')).toBe(movements);
    expect(await count('transfer_events')).toBe(events);
    const detail = await request(app).get(`/api/transfers/${id}`).set(as('MANAGER_A'));
    expect(detail.body.status).toBe('DRAFT');
    expect(detail.body.items.every((i: { unitCost: unknown }) => i.unitCost === null)).toBe(true);
  });

  it('despachar dos veces da 409 INVALID_TRANSITION y no descuenta dos veces', async () => {
    const id = await createDraft();
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')).expect(200);
    const again = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));

    expect(again.status).toBe(409);
    expect(again.body.code).toBe('INVALID_TRANSITION');
    // El mensaje habla en español, sin códigos internos
    expect(again.body.message).toBe('El traspaso está en tránsito y no admite esta acción');
    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 12 });
    const { rows } = await pool.query(`SELECT 1 FROM stock_movements WHERE type = 'TRANSFER_OUT'`);
    expect(rows).toHaveLength(1);
    expect(await count('transfer_events')).toBe(2);
  });

  it('recibir un borrador da 409 con el estado en español', async () => {
    const id = await createDraft();
    const res = await request(app)
      .post(`/api/transfers/${id}/receive`)
      .set(as('MANAGER_B'))
      .send({ items: [{ productId: product1, receivedQuantity: 8 }] });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: 'INVALID_TRANSITION',
      message: 'El traspaso está en borrador y no admite esta acción',
    });
  });

  it('despachar un traspaso cancelado da 409', async () => {
    const id = await createDraft();
    await request(app).post(`/api/transfers/${id}/cancel`).set(as('MANAGER_A')).expect(200);
    const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
  });

  it('responde 404 si el traspaso no existe', async () => {
    const res = await request(app)
      .post(`/api/transfers/${MISSING_ID}/dispatch`)
      .set(as('MANAGER_A'));
    expect(res.status).toBe(404);
  });

  it('solo despacha el jefe de la bodega de origen', async () => {
    const id = await createDraft();
    for (const who of ['OPERATOR_A', 'MANAGER_B', 'MANAGER_C', 'ADMIN', 'AUDITOR'] as const) {
      const res = await request(app).post(`/api/transfers/${id}/dispatch`).set(as(who));
      expect(res.status, who).toBe(403);
    }
    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 20 });
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')).expect(200);
  });
});

describe('POST /api/transfers/:id/cancel', () => {
  it('el jefe del origen cancela un borrador y queda el evento con el motivo', async () => {
    const id = await createDraft('OPERATOR_A');
    const res = await request(app)
      .post(`/api/transfers/${id}/cancel`)
      .set(as('MANAGER_A'))
      .send({ reason: 'Ya no hace falta' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
    expect(res.body.events.at(-1)).toMatchObject({
      fromStatus: 'DRAFT',
      toStatus: 'CANCELLED',
      reason: 'Ya no hace falta',
    });
    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 20 });
  });

  it('el operario cancela el que creó, sin cuerpo', async () => {
    const id = await createDraft('OPERATOR_A');
    const res = await request(app).post(`/api/transfers/${id}/cancel`).set(as('OPERATOR_A'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');
  });

  it('el operario no cancela el de otro (403), aunque sea de su bodega', async () => {
    const id = await createDraft('MANAGER_A');
    for (const who of ['OPERATOR_A', 'OPERATOR_A2'] as const) {
      const res = await request(app).post(`/api/transfers/${id}/cancel`).set(as(who));
      expect(res.status, who).toBe(403);
    }
  });

  it.each(['MANAGER_B', 'ADMIN', 'AUDITOR'] as const)('niega con 403 a %s', async (who) => {
    const id = await createDraft();
    const res = await request(app).post(`/api/transfers/${id}/cancel`).set(as(who));
    expect(res.status).toBe(403);
  });

  it('cancelar un traspaso en tránsito da 409 INVALID_TRANSITION', async () => {
    const id = await createDraft();
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')).expect(200);
    const res = await request(app).post(`/api/transfers/${id}/cancel`).set(as('MANAGER_A'));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('INVALID_TRANSITION');
    expect(await level(warehouseA, product1)).toMatchObject({ quantity: 12 });
  });

  it('rechaza un id que no es UUID con 400', async () => {
    const res = await request(app).post('/api/transfers/abc/cancel').set(as('MANAGER_A'));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/transfers y /api/transfers/:id', () => {
  it('cada rol ve solo lo suyo: origen o destino asignados; ADMIN y AUDITOR, todo', async () => {
    const id = await createDraft();
    const visibility: [Who, number][] = [
      ['MANAGER_A', 1],
      ['OPERATOR_A', 1],
      ['MANAGER_B', 1], // destino
      ['MANAGER_C', 0],
      ['ADMIN', 1],
      ['AUDITOR', 1],
    ];
    for (const [who, total] of visibility) {
      const list = await request(app).get('/api/transfers').set(as(who));
      expect(list.status, who).toBe(200);
      expect(list.body.total, who).toBe(total);
      const detail = await request(app).get(`/api/transfers/${id}`).set(as(who));
      expect(detail.status, who).toBe(total === 1 ? 200 : 403);
    }
  });

  it('el listado trae bodegas, número de ítems y respeta filtros y paginación', async () => {
    const first = await createDraft('MANAGER_A', [
      { productId: product1, quantity: 1 },
      { productId: product2, quantity: 1 },
    ]);
    const second = await createDraft();
    await request(app).post(`/api/transfers/${second}/dispatch`).set(as('MANAGER_A')).expect(200);

    const all = await request(app).get('/api/transfers').set(as('ADMIN'));
    expect(all.body).toMatchObject({ page: 1, pageSize: 20, total: 2 });
    const row = all.body.data.find((t: { id: string }) => t.id === first);
    expect(row).toMatchObject({
      status: 'DRAFT',
      itemCount: 2,
      origin: { id: warehouseA, code: 'A', name: 'Bodega A' },
      destination: { id: warehouseB, code: 'B' },
    });

    const byStatus = await request(app).get('/api/transfers?status=IN_TRANSIT').set(as('ADMIN'));
    expect(byStatus.body.data.map((t: { id: string }) => t.id)).toEqual([second]);

    const byWarehouse = await request(app)
      .get(`/api/transfers?warehouseId=${warehouseC}`)
      .set(as('ADMIN'));
    expect(byWarehouse.body.total).toBe(0);

    const paged = await request(app).get('/api/transfers?page=2&pageSize=1').set(as('ADMIN'));
    expect(paged.body).toMatchObject({ page: 2, pageSize: 1, total: 2 });
    expect(paged.body.data).toHaveLength(1);

    const invalid = await request(app).get('/api/transfers?status=LOST').set(as('ADMIN'));
    expect(invalid.status).toBe(400);
  });

  it('el OPERATOR no recibe unitCost y los demás roles sí', async () => {
    const id = await createDraft();
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')).expect(200);

    const operator = await request(app).get(`/api/transfers/${id}`).set(as('OPERATOR_A'));
    expect(operator.status).toBe(200);
    expect(operator.body.items[0]).not.toHaveProperty('unitCost');
    expect(JSON.stringify(operator.body)).not.toContain('110.0000');

    for (const who of ['MANAGER_A', 'MANAGER_B', 'ADMIN', 'AUDITOR'] as const) {
      const res = await request(app).get(`/api/transfers/${id}`).set(as(who));
      expect(res.body.items[0].unitCost, who).toBe('110.0000');
    }

    const created = await request(app)
      .post('/api/transfers')
      .set(as('OPERATOR_A'))
      .send(draftBody());
    expect(created.body.items[0]).not.toHaveProperty('unitCost');
  });

  it('responde 404 si no existe y 400 si el id no es UUID', async () => {
    expect((await request(app).get(`/api/transfers/${MISSING_ID}`).set(as('ADMIN'))).status).toBe(
      404,
    );
    expect((await request(app).get('/api/transfers/abc').set(as('ADMIN'))).status).toBe(400);
  });

  it('el historial de movimientos muestra el TRANSFER_OUT con su traspaso', async () => {
    const id = await createDraft();
    await request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')).expect(200);
    const res = await request(app)
      .get(`/api/stock/movements?warehouseId=${warehouseA}`)
      .set(as('MANAGER_A'));
    expect(res.body.data[0]).toMatchObject({
      type: 'TRANSFER_OUT',
      transferId: id,
      reason: null,
      balanceQty: 12,
    });
    expect(res.body.data.at(-1)).toMatchObject({ type: 'ENTRY', transferId: null });
  });
});
