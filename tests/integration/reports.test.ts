import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createReportsRepository } from '../../src/repositories/reports';
import { createUsersRepository } from '../../src/repositories/users';
import { createReportsService } from '../../src/services/reports';
import { createWarehouseAccess } from '../../src/services/warehouse-access';
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

/** Lee el cuerpo como bytes (PDF) en vez de dejar que supertest lo interprete. */
function binary(res: request.Response, done: (err: Error | null, body: Buffer) => void): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
}

/** Fecha de hoy (AAAA-MM-DD) en la zona horaria de los reportes. */
function todayInBogota(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(date);
}

function report(who: Who, path: string, query: Record<string, string> = {}): request.Test {
  return request(app).get(`/api/reports/${path}`).query(query).set(as(who));
}

describe('GET /api/reports/shrinkage', () => {
  // Además de lo de arriba (merma DAMAGE de 2 u en A a $104.1176 y la merma en tránsito de 1 u a
  // $90 registrada en A): otra DAMAGE de 1 u en A con nota y un robo de 1 u en B a $90.
  beforeAll(async () => {
    const shrink = (who: Who, warehouseId: string, reason: string, note: string) =>
      ok(
        request(app)
          .post('/api/stock/shrinkage')
          .set(as(who))
          .send({ warehouseId, productId: product, quantity: 1, reason, note }),
        201,
      );
    await shrink('MANAGER_A', warehouseA, 'DAMAGE', 'golpe al descargar');
    await shrink('MANAGER_B', warehouseB, 'THEFT', 'faltante en conteo');
  });

  it('agrupa por bodega, producto, tipo y código del motivo, con valores exactos', async () => {
    const res = await ok(report('ADMIN', 'shrinkage'));

    expect(
      res.body.data.map((r: Record<string, unknown>) => [
        r.warehouseCode,
        r.productSku,
        r.type,
        r.reason,
        r.quantity,
        r.value,
      ]),
    ).toEqual([
      ['A', 'SKU-1', 'SHRINKAGE', 'DAMAGE', 3, '312.3528'],
      ['A', 'SKU-1', 'TRANSIT_SHRINKAGE', null, 1, '90.0000'],
      ['B', 'SKU-1', 'SHRINKAGE', 'THEFT', 1, '90.0000'],
    ]);
    expect(res.body.totals).toEqual({ quantity: 5, value: '492.3528' });
  });

  it('filtra por bodega', async () => {
    const res = await ok(report('AUDITOR', 'shrinkage', { warehouseId: warehouseB }));
    expect(res.body.data).toHaveLength(1);
    expect(res.body.totals).toEqual({ quantity: 1, value: '90.0000' });
  });

  it('filtra por fechas (inclusive, en hora de Colombia)', async () => {
    const today = todayInBogota();
    const all = await ok(report('ADMIN', 'shrinkage', { from: today, to: today }));
    const future = await ok(report('ADMIN', 'shrinkage', { from: todayInBogota(1) }));
    const past = await ok(report('ADMIN', 'shrinkage', { to: todayInBogota(-1) }));

    expect(all.body.totals.quantity).toBe(5);
    expect(future.body).toEqual({ data: [], totals: { quantity: 0, value: '0.0000' } });
    expect(past.body.data).toEqual([]);
  });

  it('el jefe sin bodega en la query ve solo las suyas; una ajena da 403', async () => {
    const own = await ok(report('MANAGER_A', 'shrinkage'));
    expect(own.body.data.every((r: { warehouseCode: string }) => r.warehouseCode === 'A')).toBe(
      true,
    );
    expect((await report('MANAGER_A', 'shrinkage', { warehouseId: warehouseB })).status).toBe(403);
  });

  it('el OPERATOR recibe 403', async () => {
    expect((await report('OPERATOR_A', 'shrinkage')).status).toBe(403);
  });

  it('fechas inválidas o al revés dan 400', async () => {
    const reversed = await report('ADMIN', 'shrinkage', { from: '2026-11-05', to: '2026-11-01' });
    expect(reversed.status).toBe(400);
    expect((await report('ADMIN', 'shrinkage', { from: '05/11/2026' })).status).toBe(400);
  });
});

describe('exportaciones', () => {
  it('el kardex en CSV: descarga con nombre, BOM, tildes y una línea por fila', async () => {
    const api = await ok(kardex('ADMIN', warehouseA));
    const res = await ok(
      report('ADMIN', 'kardex/export', {
        warehouseId: warehouseA,
        productId: product,
        format: 'csv',
      }),
    );

    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename=kardex-A-SKU-1.csv');
    expect(res.text.charCodeAt(0)).toBe(0xfeff);
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      '﻿Fecha,Tipo,Referencia,Entrada,Salida,Saldo,Costo unitario,CPP,Valor del saldo',
    );
    expect(lines).toHaveLength(api.body.data.length + 1);
    expect(res.text).toContain('Merma en tránsito,1 perdidas en tránsito · Una caja se perdió');
    expect(res.text).toContain(`Traspaso ${outbound}`);
    expect(res.text).toContain(',15,104.1176,104.1176,1561.7640');
  });

  it('el kardex en PDF: application/pdf, adjunto y no vacío', async () => {
    const res = await request(app)
      .get('/api/reports/kardex/export')
      .query({ warehouseId: warehouseA, productId: product, format: 'pdf' })
      .set(as('MANAGER_A'))
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename=kardex-A-SKU-1.pdf');
    expect(Buffer.isBuffer(res.body) && res.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('las mermas en CSV llevan los motivos traducidos y la fila de totales', async () => {
    const res = await ok(report('AUDITOR', 'shrinkage/export', { format: 'csv' }));

    expect(res.headers['content-disposition']).toBe('attachment; filename=mermas-inicio-a-hoy.csv');
    const lines = res.text.trimEnd().split('\r\n');
    expect(lines.slice(1)).toEqual([
      'A · Bodega A,SKU-1,Tornillo,Merma,Daño,3,312.3528',
      'A · Bodega A,SKU-1,Tornillo,Merma en tránsito,,1,90.0000',
      'B · Bodega B,SKU-1,Tornillo,Merma,Robo,1,90.0000',
      'Total,,,,,5,492.3528',
    ]);
  });

  it('las mermas en PDF se generan', async () => {
    const res = await request(app)
      .get('/api/reports/shrinkage/export')
      .query({ format: 'pdf', from: '2026-01-01' })
      .set(as('ADMIN'))
      .buffer(true)
      .parse(binary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('mermas-2026-01-01-a-hoy.pdf');
    expect(res.body.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('OPERATOR y jefe en bodega ajena reciben 403; un formato desconocido da 400', async () => {
    const query = { warehouseId: warehouseA, productId: product, format: 'csv' };
    expect((await report('OPERATOR_A', 'kardex/export', query)).status).toBe(403);
    expect((await report('OPERATOR_A', 'shrinkage/export', { format: 'pdf' })).status).toBe(403);
    expect(
      (await report('MANAGER_B', 'kardex/export', query)).status,
      'el jefe de B no exporta el kardex de A',
    ).toBe(403);
    expect((await report('ADMIN', 'kardex/export', { ...query, format: 'xls' })).status).toBe(400);
  });
});

describe('GET /api/reports/in-transit', () => {
  let pending: string;

  // A tiene 14 u a $104.1176: se despachan 2 a B y quedan en tránsito
  beforeAll(async () => {
    pending = await dispatch('MANAGER_A', warehouseA, warehouseB, 2);
  });

  it('lista los traspasos en tránsito con días y valor al costo congelado', async () => {
    const res = await ok(report('AUDITOR', 'in-transit'));

    expect(res.body.data).toEqual([
      {
        transferId: pending,
        originWarehouseId: warehouseA,
        originCode: 'A',
        originName: 'Bodega A',
        destinationWarehouseId: warehouseB,
        destinationCode: 'B',
        destinationName: 'Bodega B',
        dispatchedAt: expect.any(String),
        daysInTransit: 0,
        quantity: 2,
        value: '208.2352',
      },
    ]);
    expect(res.body.totals).toEqual({ transfers: 1, quantity: 2, value: '208.2352' });
  });

  it('los traspasos ya recibidos o resueltos no aparecen', async () => {
    const res = await ok(report('ADMIN', 'in-transit'));
    expect(res.body.data.map((r: { transferId: string }) => r.transferId)).toEqual([pending]);
  });

  it('el jefe del origen y el del destino lo ven; filtrar por una bodega ajena da 403', async () => {
    expect((await ok(report('MANAGER_A', 'in-transit'))).body.totals.transfers).toBe(1);
    expect((await ok(report('MANAGER_B', 'in-transit'))).body.totals.transfers).toBe(1);
    expect((await report('MANAGER_B', 'in-transit', { warehouseId: warehouseA })).status).toBe(403);
  });

  it('el OPERATOR recibe 403', async () => {
    expect((await report('OPERATOR_A', 'in-transit')).status).toBe(403);
  });

  it('Swagger documenta los reportes y las exportaciones', async () => {
    const res = await request(app).get('/api-docs.json');
    for (const path of [
      '/api/reports/kardex/export',
      '/api/reports/shrinkage',
      '/api/reports/shrinkage/export',
      '/api/reports/in-transit',
    ]) {
      expect(res.body.paths).toHaveProperty([path]);
    }
  });
});

describe('GET /api/reports/summary', () => {
  // Estado al final de los bloques de arriba: A con 12 u a $104.1176 (2 en tránsito hacia B),
  // B con 5 u a $90; traspasos: uno recibido, uno resuelto y uno en tránsito; mermas de hoy:
  // 3 u DAMAGE en A ($312.3528), 1 u en tránsito registrada en A ($90) y 1 u THEFT en B ($90).
  const STATUSES = {
    DRAFT: 0,
    IN_TRANSIT: 1,
    RECEIVED: 1,
    DISCREPANCY: 0,
    RESOLVED: 1,
    CANCELLED: 0,
  };

  it('el ADMIN ve todas las bodegas con valores exactos', async () => {
    const res = await ok(report('ADMIN', 'summary'));

    expect(res.body).toEqual({
      inventoryValueByWarehouse: [
        { warehouseId: warehouseA, code: 'A', name: 'Bodega A', value: '1249.4112' },
        { warehouseId: warehouseB, code: 'B', name: 'Bodega B', value: '450.0000' },
      ],
      transfersByStatus: STATUSES,
      shrinkageLast30Days: { quantity: 5, value: '492.3528' },
      inTransitValue: '208.2352',
    });
  });

  it('el AUDITOR ve lo mismo que el ADMIN', async () => {
    const admin = await ok(report('ADMIN', 'summary'));
    const auditor = await ok(report('AUDITOR', 'summary'));
    expect(auditor.body).toEqual(admin.body);
  });

  it('el jefe de bodega ve solo su bodega', async () => {
    const res = await ok(report('MANAGER_A', 'summary'));

    expect(res.body.inventoryValueByWarehouse).toEqual([
      { warehouseId: warehouseA, code: 'A', name: 'Bodega A', value: '1249.4112' },
    ]);
    // Los tres traspasos tienen a A como origen o destino
    expect(res.body.transfersByStatus).toEqual(STATUSES);
    expect(res.body.shrinkageLast30Days).toEqual({ quantity: 4, value: '402.3528' });
    expect(res.body.inTransitValue).toBe('208.2352');

    const b = await ok(report('MANAGER_B', 'summary'));
    expect(b.body.inventoryValueByWarehouse.map((w: { code: string }) => w.code)).toEqual(['B']);
    expect(b.body.shrinkageLast30Days).toEqual({ quantity: 1, value: '90.0000' });
  });

  it('las mermas de hace más de 30 días no cuentan', async () => {
    // El libro es inmutable (no se pueden envejecer las mermas): se adelanta el reloj del servicio
    const in31Days = new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    const users = createUsersRepository(pool);
    const service = createReportsService({
      store: createReportsRepository(pool),
      access: createWarehouseAccess({
        assignments: { warehouseIdsOf: (userId) => users.warehouseIdsOf(userId) },
      }),
      now: () => in31Days,
    });

    const summary = await service.summary({ userId: 'u-admin', role: 'ADMIN' });

    expect(summary.shrinkageLast30Days).toEqual({ quantity: 0, value: '0.0000' });
    expect(summary.inTransitValue).toBe('208.2352');
  });

  it('el OPERATOR recibe 403', async () => {
    const res = await report('OPERATOR_A', 'summary');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('Swagger lo documenta', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.body.paths).toHaveProperty(['/api/reports/summary']);
  });
});
