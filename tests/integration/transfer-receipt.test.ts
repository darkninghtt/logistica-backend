import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const COST_FIELDS = ['unitCost'];

type Who =
  | 'ADMIN'
  | 'AUDITOR'
  | 'MANAGER_A'
  | 'OPERATOR_A'
  | 'MANAGER_B'
  | 'MANAGER_B2'
  | 'OPERATOR_B'
  | 'MANAGER_C';

const tokens: Partial<Record<Who, string>> = {};
const users: Partial<Record<Who, string>> = {};
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
  role: 'WAREHOUSE_MANAGER' | 'OPERATOR' | 'AUDITOR',
  warehouseIds: string[],
): Promise<void> {
  const email = `${who.toLowerCase()}@example.com`;
  const created = await request(app)
    .post('/api/users')
    .set(as('ADMIN'))
    .send({ email, name: who, role, password: PASSWORD });
  expect(created.status).toBe(201);
  users[who] = created.body.id;
  const assigned = await request(app)
    .put(`/api/users/${created.body.id}/warehouses`)
    .set(as('ADMIN'))
    .send({ warehouseIds });
  expect(assigned.status).toBe(200);
  tokens[who] = await login(email, PASSWORD);
}

async function entry(warehouseId: string, productId: string, quantity: number, unitCost: string) {
  const res = await request(app)
    .post('/api/stock/entries')
    .set(as('ADMIN'))
    .send({ warehouseId, productId, quantity, unitCost });
  expect(res.status).toBe(201);
}

interface Line {
  productId: string;
  quantity: number;
}

/** Crea un borrador y lo despacha: queda IN_TRANSIT con el costo congelado. */
async function inTransit(
  items: Line[] = [{ productId: product1, quantity: 8 }],
  route: { from: Who; origin: string; destination: string } = {
    from: 'MANAGER_A',
    origin: warehouseA,
    destination: warehouseB,
  },
): Promise<string> {
  const created = await request(app).post('/api/transfers').set(as(route.from)).send({
    originWarehouseId: route.origin,
    destinationWarehouseId: route.destination,
    items,
  });
  expect(created.status).toBe(201);
  const dispatched = await request(app)
    .post(`/api/transfers/${created.body.id}/dispatch`)
    .set(as('MANAGER_A'));
  expect(dispatched.status).toBe(200);
  return created.body.id;
}

function declared(...pairs: [string, number][]): { items: Record<string, unknown>[] } {
  return { items: pairs.map(([productId, receivedQuantity]) => ({ productId, receivedQuantity })) };
}

function receive(who: Who, id: string, body: Record<string, unknown>) {
  return request(app).post(`/api/transfers/${id}/receive`).set(as(who)).send(body);
}

function resolve(
  who: Who,
  id: string,
  body: Record<string, unknown> = { reason: 'Se perdió en ruta' },
) {
  return request(app).post(`/api/transfers/${id}/resolve`).set(as(who)).send(body);
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

interface MovementRow {
  type: string;
  warehouse_id: string;
  product_id: string;
  quantity: number;
  unit_cost: string;
  balance_qty: number;
  balance_avg_cost: string;
  reason: string | null;
  transfer_id: string | null;
  created_by: string;
}

async function movements(type: string): Promise<MovementRow[]> {
  const { rows } = await pool.query<MovementRow>(
    `SELECT type, warehouse_id, product_id, quantity, unit_cost, balance_qty, balance_avg_cost,
            reason, transfer_id, created_by
     FROM stock_movements WHERE type = $1 ORDER BY id`,
    [type],
  );
  return rows;
}

async function count(table: 'stock_movements' | 'transfer_events'): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(rows[0]?.n);
}

async function statusOf(id: string): Promise<string | undefined> {
  const { rows } = await pool.query<{ status: string }>(
    'SELECT status FROM transfers WHERE id = $1',
    [id],
  );
  return rows[0]?.status;
}

// Escenario: A tiene 20 u de P1 a $110 (10 a $100 y 10 a $120) y 10 u de P2 a $50. Despachar 8 u
// de P1 deja 12 u en A. Jefe y operario de A; dos jefes (B y B2) y un operario de B; un jefe ajeno (C).
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
  const warehouseC = await makeWarehouse('C');
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
  await createUser('MANAGER_B', 'WAREHOUSE_MANAGER', [warehouseB]);
  await createUser('MANAGER_B2', 'WAREHOUSE_MANAGER', [warehouseB]);
  await createUser('OPERATOR_B', 'OPERATOR', [warehouseB]);
  await createUser('MANAGER_C', 'WAREHOUSE_MANAGER', [warehouseC]);
  await createUser('AUDITOR', 'AUDITOR', []);

  await entry(warehouseA, product1, 10, '100');
  await entry(warehouseA, product1, 10, '120');
  await entry(warehouseA, product2, 10, '50');
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('POST /api/transfers/:id/receive', () => {
  it('recepción exacta: pasa a RECEIVED y el destino con stock cero entra al costo congelado', async () => {
    const id = await inTransit();
    expect(await level(warehouseB, product1)).toBeUndefined();

    const res = await receive('OPERATOR_B', id, declared([product1, 8]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RECEIVED');
    expect(res.body.receivedBy).toBe(users.OPERATOR_B);
    expect(res.body.items[0]).toMatchObject({ quantitySent: 8, quantityReceived: 8 });
    expect(res.body.events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'DRAFT',
      'IN_TRANSIT',
      'RECEIVED',
    ]);
    expect(res.body.events[2].actor.id).toBe(users.OPERATOR_B);

    expect(await level(warehouseB, product1)).toEqual({ quantity: 8, avg_cost: '110.0000' });
    expect(await movements('TRANSFER_IN')).toEqual([
      {
        type: 'TRANSFER_IN',
        warehouse_id: warehouseB,
        product_id: product1,
        quantity: 8,
        unit_cost: '110.0000',
        balance_qty: 8,
        balance_avg_cost: '110.0000',
        reason: null,
        transfer_id: id,
        created_by: users.OPERATOR_B,
      },
    ]);
    // El origen no cambia al recibir
    expect(await level(warehouseA, product1)).toEqual({ quantity: 12, avg_cost: '110.0000' });
  });

  it('recalcula el CPP del destino cuando ya tiene stock', async () => {
    await entry(warehouseB, product1, 10, '50');
    const id = await inTransit();

    const res = await receive('MANAGER_B', id, declared([product1, 8]));

    expect(res.status).toBe(200);
    // (10 × 50 + 8 × 110) / 18 = 76.6667
    expect(await level(warehouseB, product1)).toEqual({ quantity: 18, avg_cost: '76.6667' });
    const [movement] = await movements('TRANSFER_IN');
    expect(movement).toMatchObject({ balance_qty: 18, balance_avg_cost: '76.6667' });
  });

  it('con faltante: DISCREPANCY, entra solo lo recibido y la diferencia no toca stock ni CPP', async () => {
    const id = await inTransit();

    const res = await receive('OPERATOR_B', id, declared([product1, 7]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISCREPANCY');
    expect(res.body.items[0]).toMatchObject({ quantitySent: 8, quantityReceived: 7 });
    expect(await level(warehouseB, product1)).toEqual({ quantity: 7, avg_cost: '110.0000' });
    expect(await level(warehouseA, product1)).toEqual({ quantity: 12, avg_cost: '110.0000' });
    expect(await movements('TRANSIT_SHRINKAGE')).toEqual([]);
    expect((await movements('TRANSFER_IN'))[0]).toMatchObject({ quantity: 7 });
  });

  it('con sobrante: entra lo enviado y el resto queda retenido', async () => {
    const id = await inTransit();

    const res = await receive('OPERATOR_B', id, declared([product1, 10]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISCREPANCY');
    expect(res.body.items[0]).toMatchObject({ quantitySent: 8, quantityReceived: 10 });
    expect(await level(warehouseB, product1)).toEqual({ quantity: 8, avg_cost: '110.0000' });
    expect(await movements('ADJUSTMENT_IN')).toEqual([]);
  });

  it('si no llegó nada: DISCREPANCY y no se escribe ningún movimiento en el destino', async () => {
    const id = await inTransit();

    const res = await receive('OPERATOR_B', id, declared([product1, 0]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISCREPANCY');
    expect(await movements('TRANSFER_IN')).toEqual([]);
    expect(await level(warehouseB, product1)).toBeUndefined();
  });

  it('varios ítems: cada uno entra con su propia cantidad y el estado sale de la mezcla', async () => {
    const id = await inTransit([
      { productId: product1, quantity: 5 },
      { productId: product2, quantity: 4 },
    ]);

    const res = await receive('OPERATOR_B', id, declared([product1, 5], [product2, 3]));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('DISCREPANCY');
    expect(await level(warehouseB, product1)).toEqual({ quantity: 5, avg_cost: '110.0000' });
    expect(await level(warehouseB, product2)).toEqual({ quantity: 3, avg_cost: '50.0000' });
  });

  it('el OPERATOR no recibe unitCost en la respuesta y el jefe sí', async () => {
    const operatorId = await inTransit();
    const operator = await receive('OPERATOR_B', operatorId, declared([product1, 8]));
    for (const field of COST_FIELDS) expect(JSON.stringify(operator.body)).not.toContain(field);

    const managerId = await inTransit();
    const manager = await receive('MANAGER_B', managerId, declared([product1, 8]));
    expect(manager.body.items[0].unitCost).toBe('110.0000');
  });

  describe('declaración incompleta o inválida', () => {
    it.each([
      ['falta un ítem', () => declared([product1, 5])],
      [
        'sobra un producto ajeno al traspaso',
        () => declared([product1, 5], [product2, 4], [MISSING_ID, 1]),
      ],
      ['producto repetido', () => declared([product1, 5], [product1, 5])],
      ['cantidad negativa', () => declared([product1, -1], [product2, 4])],
      ['cantidad decimal', () => declared([product1, 1.5], [product2, 4])],
      ['sin ítems', () => ({ items: [] })],
      ['cuerpo vacío', () => ({})],
    ])('%s da 400 y no cambia nada', async (_name, body) => {
      const id = await inTransit([
        { productId: product1, quantity: 5 },
        { productId: product2, quantity: 4 },
      ]);
      const events = await count('transfer_events');
      const ledger = await count('stock_movements');

      const res = await receive('OPERATOR_B', id, body());

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(await statusOf(id)).toBe('IN_TRANSIT');
      expect(await level(warehouseB, product1)).toBeUndefined();
      expect(await count('transfer_events')).toBe(events);
      expect(await count('stock_movements')).toBe(ledger);
    });

    it('un producto que no está en el traspaso da 400', async () => {
      const id = await inTransit();
      const res = await receive('OPERATOR_B', id, declared([product2, 8]));
      expect(res.status).toBe(400);
      expect(await statusOf(id)).toBe('IN_TRANSIT');
    });
  });

  describe('idempotencia y estados', () => {
    it('recibir dos veces da 409 INVALID_TRANSITION y no vuelve a contabilizar', async () => {
      const id = await inTransit();
      await receive('OPERATOR_B', id, declared([product1, 8]));
      const ledger = await count('stock_movements');

      const again = await receive('OPERATOR_B', id, declared([product1, 8]));

      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVALID_TRANSITION');
      expect(await level(warehouseB, product1)).toEqual({ quantity: 8, avg_cost: '110.0000' });
      expect(await count('stock_movements')).toBe(ledger);
    });

    it('recibir un traspaso en DISCREPANCY también da 409', async () => {
      const id = await inTransit();
      await receive('OPERATOR_B', id, declared([product1, 7]));

      const again = await receive('OPERATOR_B', id, declared([product1, 8]));

      expect(again.status).toBe(409);
      expect(await level(warehouseB, product1)).toEqual({ quantity: 7, avg_cost: '110.0000' });
    });

    it.each(['borrador', 'cancelado'])('recibir un traspaso %s da 409', async (kind) => {
      const created = await request(app)
        .post('/api/transfers')
        .set(as('MANAGER_A'))
        .send({
          originWarehouseId: warehouseA,
          destinationWarehouseId: warehouseB,
          items: [{ productId: product1, quantity: 8 }],
        });
      if (kind === 'cancelado') {
        await request(app).post(`/api/transfers/${created.body.id}/cancel`).set(as('MANAGER_A'));
      }

      const res = await receive('OPERATOR_B', created.body.id, declared([product1, 8]));

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect(await level(warehouseB, product1)).toBeUndefined();
    });

    it('un traspaso que no existe da 404 y un id que no es UUID, 400', async () => {
      expect((await receive('OPERATOR_B', MISSING_ID, declared([product1, 1]))).status).toBe(404);
      expect((await receive('OPERATOR_B', 'no-es-uuid', declared([product1, 1]))).status).toBe(400);
    });
  });

  describe('autorización', () => {
    it.each(['OPERATOR_B', 'MANAGER_B'] as const)(
      '%s, con el destino asignado, recibe',
      async (who) => {
        const id = await inTransit();
        const res = await receive(who, id, declared([product1, 8]));
        expect(res.status).toBe(200);
      },
    );

    it.each(['MANAGER_A', 'OPERATOR_A', 'MANAGER_C', 'ADMIN', 'AUDITOR'] as const)(
      '%s recibe 403 y no cambia nada',
      async (who) => {
        const id = await inTransit();
        const ledger = await count('stock_movements');

        const res = await receive(who, id, declared([product1, 8]));

        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN');
        expect(await statusOf(id)).toBe('IN_TRANSIT');
        expect(await level(warehouseB, product1)).toBeUndefined();
        expect(await count('stock_movements')).toBe(ledger);
      },
    );

    it('sin token da 401', async () => {
      const id = await inTransit();
      const res = await request(app)
        .post(`/api/transfers/${id}/receive`)
        .send(declared([product1, 8]));
      expect(res.status).toBe(401);
    });
  });
});

describe('POST /api/transfers/:id/resolve', () => {
  /** Despacha 8 u de P1, el destino recibe `received` y deja el traspaso en DISCREPANCY. */
  async function discrepancy(received: number, receiver: Who = 'OPERATOR_B'): Promise<string> {
    const id = await inTransit();
    const res = await receive(receiver, id, declared([product1, received]));
    expect(res.body.status).toBe('DISCREPANCY');
    return id;
  }

  it('faltante: registra la merma en tránsito al costo congelado, con motivo y usuario, y el origen no recupera nada', async () => {
    const id = await discrepancy(7);

    const res = await resolve('MANAGER_B', id, { reason: 'Se perdió en ruta' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESOLVED');
    expect(res.body.resolvedBy).toBe(users.MANAGER_B);
    const last = res.body.events.at(-1);
    expect(last).toMatchObject({
      fromStatus: 'DISCREPANCY',
      toStatus: 'RESOLVED',
      reason: 'Se perdió en ruta',
    });
    expect(last.actor.id).toBe(users.MANAGER_B);

    expect(await movements('TRANSIT_SHRINKAGE')).toEqual([
      {
        type: 'TRANSIT_SHRINKAGE',
        warehouse_id: warehouseB,
        product_id: product1,
        quantity: 1,
        unit_cost: '110.0000',
        // No mueve stock: el saldo y el costo del destino quedan como estaban
        balance_qty: 7,
        balance_avg_cost: '110.0000',
        reason: 'Se perdió en ruta',
        transfer_id: id,
        created_by: users.MANAGER_B,
      },
    ]);
    expect(await level(warehouseB, product1)).toEqual({ quantity: 7, avg_cost: '110.0000' });
    expect(await level(warehouseA, product1)).toEqual({ quantity: 12, avg_cost: '110.0000' });
  });

  it('sobrante: entra al destino como ajuste al costo congelado y recalcula el CPP', async () => {
    await entry(warehouseB, product1, 10, '50');
    const id = await discrepancy(10);
    // Al recibir entraron 8 u: (10 × 50 + 8 × 110) / 18 = 76.6667
    expect(await level(warehouseB, product1)).toEqual({ quantity: 18, avg_cost: '76.6667' });

    const res = await resolve('MANAGER_B2', id, { reason: 'Llegó de más' });

    expect(res.status).toBe(200);
    // (18 × 76.6667 + 2 × 110) / 20 = 80.0000
    expect(await level(warehouseB, product1)).toEqual({ quantity: 20, avg_cost: '80.0000' });
    expect(await movements('ADJUSTMENT_IN')).toEqual([
      {
        type: 'ADJUSTMENT_IN',
        warehouse_id: warehouseB,
        product_id: product1,
        quantity: 2,
        unit_cost: '110.0000',
        balance_qty: 20,
        balance_avg_cost: '80.0000',
        reason: 'Llegó de más',
        transfer_id: id,
        created_by: users.MANAGER_B2,
      },
    ]);
    expect(await movements('TRANSIT_SHRINKAGE')).toEqual([]);
    expect(await level(warehouseA, product1)).toEqual({ quantity: 12, avg_cost: '110.0000' });
  });

  it('con un faltante y un sobrante en el mismo traspaso, registra cada uno', async () => {
    const id = await inTransit([
      { productId: product1, quantity: 5 },
      { productId: product2, quantity: 4 },
    ]);
    await receive('OPERATOR_B', id, declared([product1, 3], [product2, 6]));

    const res = await resolve('MANAGER_B', id);

    expect(res.status).toBe(200);
    expect(await movements('TRANSIT_SHRINKAGE')).toHaveLength(1);
    expect((await movements('TRANSIT_SHRINKAGE'))[0]).toMatchObject({
      product_id: product1,
      quantity: 2,
    });
    expect((await movements('ADJUSTMENT_IN'))[0]).toMatchObject({
      product_id: product2,
      quantity: 2,
      unit_cost: '50.0000',
    });
    expect(await level(warehouseB, product1)).toEqual({ quantity: 3, avg_cost: '110.0000' });
    expect(await level(warehouseB, product2)).toEqual({ quantity: 6, avg_cost: '50.0000' });
  });

  it('si no llegó nada, todo lo enviado queda como merma en tránsito', async () => {
    const id = await discrepancy(0);

    const res = await resolve('MANAGER_B', id);

    expect(res.status).toBe(200);
    expect((await movements('TRANSIT_SHRINKAGE'))[0]).toMatchObject({
      quantity: 8,
      balance_qty: 0,
    });
    expect(await level(warehouseB, product1)).toMatchObject({ quantity: 0 });
  });

  describe('separación de funciones y permisos', () => {
    it('quien recibió no puede resolver (403), aunque sea jefe del destino; otro jefe del destino sí', async () => {
      const id = await discrepancy(7, 'MANAGER_B');
      const ledger = await count('stock_movements');

      const denied = await resolve('MANAGER_B', id);

      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe('FORBIDDEN');
      expect(await statusOf(id)).toBe('DISCREPANCY');
      expect(await count('stock_movements')).toBe(ledger);

      const allowed = await resolve('MANAGER_B2', id);
      expect(allowed.status).toBe(200);
    });

    it('el ADMIN resuelve (no recibió) y el jefe del origen también', async () => {
      const byAdmin = await discrepancy(7);
      expect((await resolve('ADMIN', byAdmin)).status).toBe(200);

      const byOrigin = await discrepancy(7);
      expect((await resolve('MANAGER_A', byOrigin)).status).toBe(200);
    });

    it.each(['OPERATOR_B', 'OPERATOR_A', 'MANAGER_C', 'AUDITOR'] as const)(
      '%s recibe 403 y no cambia nada',
      async (who) => {
        const id = await discrepancy(7);
        const ledger = await count('stock_movements');

        const res = await resolve(who, id);

        expect(res.status).toBe(403);
        expect(await statusOf(id)).toBe('DISCREPANCY');
        expect(await count('stock_movements')).toBe(ledger);
      },
    );

    it('sin token da 401', async () => {
      const id = await discrepancy(7);
      const res = await request(app).post(`/api/transfers/${id}/resolve`).send({ reason: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('validación y estados', () => {
    it.each([
      ['sin motivo', {}],
      ['motivo vacío', { reason: '' }],
      ['motivo solo con espacios', { reason: '   ' }],
      ['motivo demasiado largo', { reason: 'a'.repeat(501) }],
    ])('%s da 400 y no cambia nada', async (_name, body) => {
      const id = await discrepancy(7);
      const ledger = await count('stock_movements');

      const res = await resolve('MANAGER_B', id, body);

      expect(res.status).toBe(400);
      expect(await statusOf(id)).toBe('DISCREPANCY');
      expect(await count('stock_movements')).toBe(ledger);
    });

    it('resolver dos veces da 409 y no repite la merma en tránsito', async () => {
      const id = await discrepancy(7);
      await resolve('MANAGER_B', id);

      const again = await resolve('MANAGER_B2', id);

      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVALID_TRANSITION');
      expect(await movements('TRANSIT_SHRINKAGE')).toHaveLength(1);
    });

    it('resolver un traspaso RECIBIDO o EN TRÁNSITO da 409', async () => {
      const received = await inTransit();
      await receive('OPERATOR_B', received, declared([product1, 8]));
      const res = await resolve('MANAGER_B', received);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');

      const transit = await inTransit();
      expect((await resolve('MANAGER_B', transit)).status).toBe(409);
      expect(await statusOf(transit)).toBe('IN_TRANSIT');
    });

    it('un traspaso que no existe da 404', async () => {
      expect((await resolve('MANAGER_B', MISSING_ID)).status).toBe(404);
    });
  });
});

describe('traspaso de ida y vuelta', () => {
  it('A→B y luego B→A deja el CPP esperado en ambas bodegas', async () => {
    // Ida: 8 u de P1 a $110 de A a B
    const there = await inTransit();
    await receive('OPERATOR_B', there, declared([product1, 8]));
    expect(await level(warehouseA, product1)).toEqual({ quantity: 12, avg_cost: '110.0000' });
    expect(await level(warehouseB, product1)).toEqual({ quantity: 8, avg_cost: '110.0000' });

    // B compra 8 u más a $130: B queda con 16 u a $120
    await entry(warehouseB, product1, 8, '130');
    expect(await level(warehouseB, product1)).toEqual({ quantity: 16, avg_cost: '120.0000' });

    // Vuelta: B manda 6 u al costo de B ($120) y A las recibe
    const created = await request(app)
      .post('/api/transfers')
      .set(as('MANAGER_B'))
      .send({
        originWarehouseId: warehouseB,
        destinationWarehouseId: warehouseA,
        items: [{ productId: product1, quantity: 6 }],
      });
    expect(created.status).toBe(201);
    const back = created.body.id;
    expect(
      (await request(app).post(`/api/transfers/${back}/dispatch`).set(as('MANAGER_B'))).status,
    ).toBe(200);
    expect(await level(warehouseB, product1)).toEqual({ quantity: 10, avg_cost: '120.0000' });

    const received = await receive('OPERATOR_A', back, declared([product1, 6]));
    expect(received.status).toBe(200);
    expect(received.body.status).toBe('RECEIVED');

    // A: (12 × 110 + 6 × 120) / 18 = 113.3333; B conserva su costo al salir stock
    expect(await level(warehouseA, product1)).toEqual({ quantity: 18, avg_cost: '113.3333' });
    expect(await level(warehouseB, product1)).toEqual({ quantity: 10, avg_cost: '120.0000' });
  });
});
