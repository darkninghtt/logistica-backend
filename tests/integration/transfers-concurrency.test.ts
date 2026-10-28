import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';
import { expectLedgerMatchesLevels, expectNoDuplicateEvents } from '../helpers/ledger';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
/** Más peticiones que conexiones del pool (10): la prueba más dura para una transacción abierta. */
const N = 15;

type Who = 'ADMIN' | 'MANAGER_A' | 'OPERATOR_A' | 'MANAGER_B' | 'OPERATOR_B';

const tokens: Partial<Record<Who, string>> = {};
let warehouseA: string;
let warehouseB: string;
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
  role: 'WAREHOUSE_MANAGER' | 'OPERATOR',
  warehouseId: string,
): Promise<void> {
  const email = `${who.toLowerCase()}@example.com`;
  const created = await request(app)
    .post('/api/users')
    .set(as('ADMIN'))
    .send({ email, name: who, role, password: PASSWORD });
  expect(created.status).toBe(201);
  await request(app)
    .put(`/api/users/${created.body.id}/warehouses`)
    .set(as('ADMIN'))
    .send({ warehouseIds: [warehouseId] })
    .expect(200);
  tokens[who] = await login(email, PASSWORD);
}

async function entry(warehouseId: string, productId: string, quantity: number, unitCost: string) {
  await request(app)
    .post('/api/stock/entries')
    .set(as('ADMIN'))
    .send({ warehouseId, productId, quantity, unitCost })
    .expect(201);
}

interface Line {
  productId: string;
  quantity: number;
}

async function draft(
  who: Who,
  origin: string,
  destination: string,
  items: Line[],
): Promise<string> {
  const res = await request(app).post('/api/transfers').set(as(who)).send({
    originWarehouseId: origin,
    destinationWarehouseId: destination,
    items,
  });
  expect(res.status).toBe(201);
  return res.body.id;
}

const dispatch = (who: Who, id: string) =>
  request(app).post(`/api/transfers/${id}/dispatch`).set(as(who));

const receive = (who: Who, id: string, items: { productId: string; receivedQuantity: number }[]) =>
  request(app).post(`/api/transfers/${id}/receive`).set(as(who)).send({ items });

const resolve = (who: Who, id: string) =>
  request(app).post(`/api/transfers/${id}/resolve`).set(as(who)).send({ reason: 'Se perdió' });

async function level(warehouseId: string, productId: string): Promise<number> {
  const { rows } = await pool.query<{ quantity: number }>(
    'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
    [warehouseId, productId],
  );
  return rows[0]?.quantity ?? 0;
}

async function countMovements(type: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    'SELECT count(*) AS n FROM stock_movements WHERE type = $1',
    [type],
  );
  return Number(rows[0]?.n);
}

function codes(responses: { body: { code?: string } }[]): (string | undefined)[] {
  return responses.map((r) => r.body.code);
}

/** Toda la concurrencia termina con el libro cuadrado y sin eventos duplicados. */
async function expectConsistent(): Promise<void> {
  await expectLedgerMatchesLevels(pool);
  await expectNoDuplicateEvents(pool);
}

// Escenario: A tiene 20 u de P1 ($110) y 20 u de P2 ($50); B tiene 20 u de P1 ($80) y 20 u de P2 ($60).
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
  const makeProduct = async (sku: string): Promise<string> =>
    (
      await request(app)
        .post('/api/products')
        .set(as('ADMIN'))
        .send({ sku, name: `Producto ${sku}`, unit: 'un' })
    ).body.id;
  product1 = await makeProduct('SKU-1');
  product2 = await makeProduct('SKU-2');

  await createUser('MANAGER_A', 'WAREHOUSE_MANAGER', warehouseA);
  await createUser('OPERATOR_A', 'OPERATOR', warehouseA);
  await createUser('MANAGER_B', 'WAREHOUSE_MANAGER', warehouseB);
  await createUser('OPERATOR_B', 'OPERATOR', warehouseB);

  await entry(warehouseA, product1, 10, '100');
  await entry(warehouseA, product1, 10, '120');
  await entry(warehouseA, product2, 20, '50');
  await entry(warehouseB, product1, 20, '80');
  await entry(warehouseB, product2, 20, '60');
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('despachos en paralelo', () => {
  it('10 traspasos distintos de 3 u sobre 20 u: despachan 6, el resto da 409 y el stock no baja de cero', async () => {
    const ids = await Promise.all(
      Array.from({ length: 10 }, () =>
        draft('MANAGER_A', warehouseA, warehouseB, [{ productId: product1, quantity: 3 }]),
      ),
    );

    const responses = await Promise.all(ids.map((id) => dispatch('MANAGER_A', id)));

    expect(responses.filter((r) => r.status === 200)).toHaveLength(6);
    const rejected = responses.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(4);
    expect(codes(rejected)).toEqual(Array(4).fill('INSUFFICIENT_STOCK'));
    expect(await level(warehouseA, product1)).toBe(2);
    expect(await countMovements('TRANSFER_OUT')).toBe(6);

    // Los rechazados siguen en borrador, sin costo congelado
    const states = await pool.query<{ status: string; n: string }>(
      'SELECT status, count(*) AS n FROM transfers GROUP BY status ORDER BY status',
    );
    expect(states.rows).toEqual([
      { status: 'DRAFT', n: '4' },
      { status: 'IN_TRANSIT', n: '6' },
    ]);
    await expectConsistent();
  });

  it(`${N} despachos del mismo traspaso: uno solo se contabiliza y el resto da 409`, async () => {
    const id = await draft('MANAGER_A', warehouseA, warehouseB, [
      { productId: product1, quantity: 8 },
    ]);

    const responses = await Promise.all(Array.from({ length: N }, () => dispatch('MANAGER_A', id)));

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    const rejected = responses.filter((r) => r.status === 409);
    expect(rejected).toHaveLength(N - 1);
    expect(codes(rejected)).toEqual(Array(N - 1).fill('INVALID_TRANSITION'));
    expect(await level(warehouseA, product1)).toBe(12);
    expect(await countMovements('TRANSFER_OUT')).toBe(1);
    await expectConsistent();
  });
});

describe('recepciones y resoluciones en paralelo', () => {
  it(`${N} recepciones del mismo traspaso: una sola entra al destino`, async () => {
    const id = await draft('MANAGER_A', warehouseA, warehouseB, [
      { productId: product1, quantity: 8 },
    ]);
    await dispatch('MANAGER_A', id).expect(200);

    const responses = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        receive(i % 2 === 0 ? 'OPERATOR_B' : 'MANAGER_B', id, [
          { productId: product1, receivedQuantity: 8 },
        ]),
      ),
    );

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(codes(responses.filter((r) => r.status === 409))).toEqual(
      Array(N - 1).fill('INVALID_TRANSITION'),
    );
    expect(await level(warehouseB, product1)).toBe(28);
    expect(await countMovements('TRANSFER_IN')).toBe(1);
    await expectConsistent();
  });

  it(`${N} resoluciones de la misma discrepancia: una sola registra la merma en tránsito`, async () => {
    const id = await draft('MANAGER_A', warehouseA, warehouseB, [
      { productId: product1, quantity: 8 },
      { productId: product2, quantity: 4 },
    ]);
    await dispatch('MANAGER_A', id).expect(200);
    // Faltan 3 de P1 y llegan 2 de más de P2
    const received = await receive('OPERATOR_B', id, [
      { productId: product1, receivedQuantity: 5 },
      { productId: product2, receivedQuantity: 6 },
    ]);
    expect(received.body.status).toBe('DISCREPANCY');

    const responses = await Promise.all(Array.from({ length: N }, () => resolve('MANAGER_B', id)));

    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(codes(responses.filter((r) => r.status === 409))).toEqual(
      Array(N - 1).fill('INVALID_TRANSITION'),
    );
    expect(await countMovements('TRANSIT_SHRINKAGE')).toBe(1);
    expect(await countMovements('ADJUSTMENT_IN')).toBe(1);
    expect(await level(warehouseB, product2)).toBe(20 + 4 + 2);
    await expectConsistent();
  });
});

describe('traspasos cruzados en paralelo', () => {
  it('A→B y B→A con los mismos productos, mezclando despachos y recepciones: sin deadlock ni 500', async () => {
    for (let round = 0; round < 4; round++) {
      // Los ítems se declaran en orden distinto a propósito: el bloqueo no depende del orden del cuerpo
      const toB = await draft('MANAGER_A', warehouseA, warehouseB, [
        { productId: product1, quantity: 1 },
        { productId: product2, quantity: 1 },
      ]);
      const toA = await draft('MANAGER_B', warehouseB, warehouseA, [
        { productId: product2, quantity: 1 },
        { productId: product1, quantity: 1 },
      ]);
      const inFlightToB = await draft('MANAGER_A', warehouseA, warehouseB, [
        { productId: product2, quantity: 1 },
        { productId: product1, quantity: 1 },
      ]);
      await dispatch('MANAGER_A', inFlightToB).expect(200);
      const inFlightToA = await draft('MANAGER_B', warehouseB, warehouseA, [
        { productId: product1, quantity: 1 },
        { productId: product2, quantity: 1 },
      ]);
      await dispatch('MANAGER_B', inFlightToA).expect(200);

      const responses = await Promise.all([
        dispatch('MANAGER_A', toB),
        dispatch('MANAGER_B', toA),
        receive('OPERATOR_B', inFlightToB, [
          { productId: product1, receivedQuantity: 1 },
          { productId: product2, receivedQuantity: 1 },
        ]),
        receive('OPERATOR_A', inFlightToA, [
          { productId: product2, receivedQuantity: 1 },
          { productId: product1, receivedQuantity: 1 },
        ]),
      ]);

      expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    }
    await expectConsistent();
  });
});
