import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

type Who = 'ADMIN' | 'AUDITOR' | 'MANAGER_A' | 'MANAGER_B' | 'OPERATOR_A';
const tokens: Partial<Record<Who, string>> = {};
let warehouseA: string;
let warehouseB: string;
let product: string;
let outbound: string;
let inbound: string;

function as(who: Who): { Authorization: string } {
  return { Authorization: `Bearer ${tokens[who] ?? ''}` };
}

async function login(email: string, password: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  return res.body.accessToken;
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
  await request(app)
    .put(`/api/users/${created.body.id}/warehouses`)
    .set(as('ADMIN'))
    .send({ warehouseIds });
  tokens[who] = await login(email, PASSWORD);
}

async function ok(req: request.Test, status = 200): Promise<request.Response> {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
}

function entry(warehouseId: string, quantity: number, unitCost: string): request.Test {
  return request(app)
    .post('/api/stock/entries')
    .set(as('ADMIN'))
    .send({ warehouseId, productId: product, quantity, unitCost });
}

/** Crea y despacha un traspaso de `quantity` unidades; devuelve su id. */
async function dispatch(from: Who, origin: string, destination: string, quantity: number) {
  const created = await ok(
    request(app)
      .post('/api/transfers')
      .set(as(from))
      .send({
        originWarehouseId: origin,
        destinationWarehouseId: destination,
        items: [{ productId: product, quantity }],
      }),
    201,
  );
  await ok(request(app).post(`/api/transfers/${created.body.id}/dispatch`).set(as(from)));
  return created.body.id as string;
}

function receive(who: Who, id: string, receivedQuantity: number): request.Test {
  return request(app)
    .post(`/api/transfers/${id}/receive`)
    .set(as(who))
    .send({ items: [{ productId: product, receivedQuantity }] });
}

function kardex(who: Who, warehouseId: string, extra: Record<string, string | number> = {}) {
  return request(app)
    .get('/api/reports/kardex')
    .query({ warehouseId, productId: product, ...extra })
    .set(as(who));
}

/**
 * Caso conocido, calculado a mano:
 *   A: entra 10 a $100 y 10 a $120 → 20 u a $110.
 *   B: entra 4 a $50.
 *   Ida A→B de 8 u: sale de A al costo congelado $110 (A queda 12 u); B recibe las 8 → 12 u a
 *     (4×50 + 8×110) / 12 = $90.
 *   Vuelta B→A de 6 u: sale de B a $90 (B queda 6 u); A declara 5 → entran 5 a $90 →
 *     (12×110 + 5×90) / 17 = 104.117647… → $104.1176. Discrepancia de 1 u.
 *   El ADMIN la resuelve: merma en tránsito de 1 u a $90, sin cambiar el saldo de A.
 *   Merma de bodega en A de 2 u al costo vigente → 15 u a $104.1176.
 */
beforeAll(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  tokens.ADMIN = await login(ADMIN.email, ADMIN.password);
  const makeWarehouse = async (code: string): Promise<string> =>
    (
      await ok(
        request(app)
          .post('/api/warehouses')
          .set(as('ADMIN'))
          .send({ code, name: `Bodega ${code}` }),
        201,
      )
    ).body.id;
  warehouseA = await makeWarehouse('A');
  warehouseB = await makeWarehouse('B');
  product = (
    await ok(
      request(app)
        .post('/api/products')
        .set(as('ADMIN'))
        .send({ sku: 'SKU-1', name: 'Tornillo', unit: 'un' }),
      201,
    )
  ).body.id;
  await createUser('MANAGER_A', 'WAREHOUSE_MANAGER', [warehouseA]);
  await createUser('MANAGER_B', 'WAREHOUSE_MANAGER', [warehouseB]);
  await createUser('OPERATOR_A', 'OPERATOR', [warehouseA]);
  await createUser('AUDITOR', 'AUDITOR', []);

  await ok(entry(warehouseA, 10, '100'), 201);
  await ok(entry(warehouseA, 10, '120'), 201);
  await ok(entry(warehouseB, 4, '50'), 201);

  outbound = await dispatch('MANAGER_A', warehouseA, warehouseB, 8);
  await ok(receive('MANAGER_B', outbound, 8));

  inbound = await dispatch('MANAGER_B', warehouseB, warehouseA, 6);
  const declared = await ok(receive('MANAGER_A', inbound, 5));
  expect(declared.body.status).toBe('DISCREPANCY');
  await ok(
    request(app)
      .post(`/api/transfers/${inbound}/resolve`)
      .set(as('ADMIN'))
      .send({ reason: 'Una caja se perdió en ruta' }),
  );

  await ok(
    request(app)
      .post('/api/stock/shrinkage')
      .set(as('MANAGER_A'))
      .send({ warehouseId: warehouseA, productId: product, quantity: 2, reason: 'DAMAGE' }),
    201,
  );
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('GET /api/reports/kardex', () => {
  it('el kardex de A da los saldos, el CPP y el valor esperados fila por fila', async () => {
    const res = await ok(kardex('ADMIN', warehouseA));

    // El id y la fecha dependen de la ejecución: se compara todo lo demás
    const pick = (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).filter(([key]) => key !== 'id' && key !== 'createdAt'),
      );
    expect(res.body.data.map(pick)).toEqual([
      {
        type: 'ENTRY',
        reference: null,
        transferId: null,
        quantity: 10,
        quantityIn: 10,
        quantityOut: 0,
        balanceQty: 10,
        unitCost: '100.0000',
        balanceAvgCost: '100.0000',
        balanceValue: '1000.0000',
      },
      {
        type: 'ENTRY',
        reference: null,
        transferId: null,
        quantity: 10,
        quantityIn: 10,
        quantityOut: 0,
        balanceQty: 20,
        unitCost: '120.0000',
        balanceAvgCost: '110.0000',
        balanceValue: '2200.0000',
      },
      {
        type: 'TRANSFER_OUT',
        reference: outbound,
        transferId: outbound,
        quantity: 8,
        quantityIn: 0,
        quantityOut: 8,
        balanceQty: 12,
        unitCost: '110.0000',
        balanceAvgCost: '110.0000',
        balanceValue: '1320.0000',
      },
      {
        type: 'TRANSFER_IN',
        reference: inbound,
        transferId: inbound,
        quantity: 5,
        quantityIn: 5,
        quantityOut: 0,
        balanceQty: 17,
        unitCost: '90.0000',
        balanceAvgCost: '104.1176',
        balanceValue: '1769.9992',
      },
      {
        type: 'TRANSIT_SHRINKAGE',
        reference: 'Una caja se perdió en ruta',
        transferId: inbound,
        quantity: 1,
        quantityIn: 0,
        quantityOut: 0,
        balanceQty: 17,
        unitCost: '90.0000',
        balanceAvgCost: '104.1176',
        balanceValue: '1769.9992',
      },
      {
        type: 'SHRINKAGE',
        reference: 'DAMAGE',
        transferId: null,
        quantity: 2,
        quantityIn: 0,
        quantityOut: 2,
        balanceQty: 15,
        unitCost: '104.1176',
        balanceAvgCost: '104.1176',
        balanceValue: '1561.7640',
      },
    ]);
    expect(res.body.nextCursor).toBeNull();
    expect(res.body.warehouse).toEqual({ id: warehouseA, code: 'A', name: 'Bodega A' });
    expect(res.body.product).toEqual({ id: product, sku: 'SKU-1', name: 'Tornillo', unit: 'un' });
  });

  it('el kardex de B cuadra con la ida y la vuelta', async () => {
    const res = await ok(kardex('ADMIN', warehouseB));

    expect(
      res.body.data.map((r: Record<string, unknown>) => [
        r.type,
        r.quantityIn,
        r.quantityOut,
        r.balanceQty,
        r.balanceAvgCost,
        r.balanceValue,
      ]),
    ).toEqual([
      ['ENTRY', 4, 0, 4, '50.0000', '200.0000'],
      ['TRANSFER_IN', 8, 0, 12, '90.0000', '1080.0000'],
      ['TRANSFER_OUT', 0, 6, 6, '90.0000', '540.0000'],
    ]);
  });

  it('en cada fila, saldo anterior + entrada − salida = saldo, y el último saldo es el de stock_levels', async () => {
    for (const warehouseId of [warehouseA, warehouseB]) {
      const rows: { quantityIn: number; quantityOut: number; balanceQty: number }[] = (
        await ok(kardex('ADMIN', warehouseId))
      ).body.data;
      let balance = 0;
      for (const row of rows) {
        balance += row.quantityIn - row.quantityOut;
        expect(row.balanceQty).toBe(balance);
      }
      const { rows: level } = await pool.query<{ quantity: number }>(
        'SELECT quantity FROM stock_levels WHERE warehouse_id = $1 AND product_id = $2',
        [warehouseId, product],
      );
      expect(level[0]?.quantity).toBe(balance);
    }
  });

  it('pagina por cursor en orden cronológico sin repetir ni saltar filas', async () => {
    const all = (await ok(kardex('ADMIN', warehouseA))).body.data.map((r: { id: string }) => r.id);
    const first = await ok(kardex('ADMIN', warehouseA, { limit: 4 }));
    const second = await ok(
      kardex('ADMIN', warehouseA, { limit: 4, cursor: first.body.nextCursor }),
    );

    expect(first.body.data).toHaveLength(4);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    expect(second.body.nextCursor).toBeNull();
    expect([...first.body.data, ...second.body.data].map((r: { id: string }) => r.id)).toEqual(all);
  });

  it.each(['ADMIN', 'AUDITOR'] as const)('%s consulta cualquier bodega', async (who) => {
    await ok(kardex(who, warehouseA));
    await ok(kardex(who, warehouseB));
  });

  it('el jefe de bodega consulta la suya y recibe 403 en una ajena', async () => {
    await ok(kardex('MANAGER_A', warehouseA));
    const foreign = await kardex('MANAGER_A', warehouseB);
    expect(foreign.status).toBe(403);
    expect(foreign.body.code).toBe('FORBIDDEN');
  });

  it('el OPERATOR recibe 403 incluso en su propia bodega', async () => {
    const res = await kardex('OPERATOR_A', warehouseA);
    expect(res.status).toBe(403);
  });

  it('sin token da 401', async () => {
    const res = await request(app)
      .get('/api/reports/kardex')
      .query({ warehouseId: warehouseA, productId: product });
    expect(res.status).toBe(401);
  });

  it('bodega o producto inexistentes dan 404', async () => {
    const noWarehouse = await kardex('ADMIN', MISSING_ID);
    const noProduct = await request(app)
      .get('/api/reports/kardex')
      .query({ warehouseId: warehouseA, productId: MISSING_ID })
      .set(as('ADMIN'));
    expect(noWarehouse.status).toBe(404);
    expect(noProduct.status).toBe(404);
  });

  it('sin producto, con un cursor inválido o un límite fuera de rango da 400', async () => {
    const noProduct = await request(app)
      .get('/api/reports/kardex')
      .query({ warehouseId: warehouseA })
      .set(as('ADMIN'));
    expect(noProduct.status).toBe(400);
    expect((await kardex('ADMIN', warehouseA, { cursor: 'xyz!' })).status).toBe(400);
    expect((await kardex('ADMIN', warehouseA, { limit: 500 })).status).toBe(400);
  });

  it('Swagger documenta el kardex', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.body.paths).toHaveProperty('/api/reports/kardex');
  });
});
