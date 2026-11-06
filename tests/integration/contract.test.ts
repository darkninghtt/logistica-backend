import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { API_SCHEMAS, buildOpenApiSpec } from '../../src/swagger';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

/*
 * Prueba de contrato: cada endpoint se llama de verdad y su respuesta se valida con el esquema Zod
 * que el contrato (openapi.json) declara para ese estado HTTP. Los esquemas de respuesta son
 * estrictos, así que un campo de más, de menos o con otro tipo hace fallar la prueba. La última
 * prueba exige que todos los endpoints con respuesta JSON del contrato hayan pasado por aquí.
 */

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

// Lo justo del documento OpenAPI para encontrar el esquema de cada respuesta
const refSchema = z.object({ $ref: z.string() });
const bodySchema = z.union([
  refSchema,
  z.object({ type: z.literal('array'), items: refSchema }),
  z.object({ type: z.literal('string'), format: z.literal('binary') }),
]);
const specSchema = z.object({
  paths: z.record(
    z.string(),
    z.record(
      z.string(),
      z.object({
        responses: z.record(
          z.string(),
          z.object({ content: z.record(z.string(), z.object({ schema: bodySchema })).optional() }),
        ),
      }),
    ),
  ),
});
const spec = specSchema.parse(buildOpenApiSpec());
const schemasByName = new Map<string, z.ZodType>(Object.entries(API_SCHEMAS));

function zodFromRef(ref: { $ref: string }): z.ZodType {
  const name = ref.$ref.replace('#/components/schemas/', '');
  const schema = schemasByName.get(name);
  if (!schema) throw new Error(`El contrato cita un esquema que no existe: ${ref.$ref}`);
  return schema;
}

/** Operaciones (`MÉTODO /ruta`) cuya respuesta exitosa es JSON: todas deben comprobarse. */
function jsonOperations(): string[] {
  return Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods)
      .filter(([, op]) =>
        Object.entries(op.responses).some(
          ([status, response]) =>
            status.startsWith('2') && response.content?.['application/json'] !== undefined,
        ),
      )
      .map(([method]) => `${method.toUpperCase()} ${path}`),
  );
}

const checked = new Set<string>();

/** Valida la respuesta con el esquema que el contrato declara para `operation` y su estado. */
async function expectContract(
  operation: string,
  req: request.Test,
  status: number,
): Promise<request.Response> {
  const res = await req;
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  const [method = '', path = ''] = operation.split(' ');
  const op = spec.paths[path]?.[method.toLowerCase()];
  if (!op) throw new Error(`${operation} no está en el contrato`);
  const response = op.responses[String(status)];
  if (!response) throw new Error(`${operation} no documenta el estado ${status}`);
  const body = response.content?.['application/json']?.schema;
  if (!body) {
    expect(res.text, `${operation} no debería tener cuerpo`).toBe('');
  } else if ('$ref' in body) {
    expectParses(operation, zodFromRef(body), res.body);
  } else if (body.type === 'array') {
    expectParses(operation, z.array(zodFromRef(body.items)), res.body);
  }
  if (status < 300) checked.add(operation);
  return res;
}

function expectParses(operation: string, schema: z.ZodType, body: unknown): void {
  const result = schema.safeParse(body);
  expect(result.success, `${operation}: ${JSON.stringify(result.error?.issues)}`).toBe(true);
}

type Who = 'ADMIN' | 'MANAGER_A' | 'MANAGER_B' | 'OPERATOR_A';
const tokens: Partial<Record<Who, string>> = {};
let adminCookie = '';
let warehouseA = '';
let warehouseB = '';
let product = '';
let operatorId = '';

function as(who: Who): { Authorization: string } {
  return { Authorization: `Bearer ${tokens[who] ?? ''}` };
}

function cookieOf(res: request.Response): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [];
  return cookies.find((c) => c.startsWith('refresh_token='))?.split(';')[0] ?? '';
}

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.accessToken;
}

/** Crea y despacha un traspaso de A a B; devuelve su id. */
async function dispatchAtoB(quantity: number): Promise<string> {
  const created = await request(app)
    .post('/api/transfers')
    .set(as('MANAGER_A'))
    .send({
      originWarehouseId: warehouseA,
      destinationWarehouseId: warehouseB,
      items: [{ productId: product, quantity }],
    });
  await request(app).post(`/api/transfers/${created.body.id}/dispatch`).set(as('MANAGER_A'));
  return created.body.id;
}

beforeAll(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
});

afterAll(async () => {
  await pool.end();
});

describe('contrato de la API (respuestas reales contra openapi.json)', () => {
  it('autenticación', async () => {
    const res = await expectContract(
      'POST /api/auth/login',
      request(app).post('/api/auth/login').send({ email: ADMIN.email, password: ADMIN.password }),
      200,
    );
    tokens.ADMIN = res.body.accessToken;
    adminCookie = cookieOf(res);

    const renewed = await expectContract(
      'POST /api/auth/refresh',
      request(app).post('/api/auth/refresh').set('Cookie', adminCookie),
      200,
    );
    adminCookie = cookieOf(renewed);
    await expectContract(
      'GET /api/auth/me',
      request(app).get('/api/auth/me').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'GET /api/auth/sessions',
      request(app).get('/api/auth/sessions').set(as('ADMIN')).set('Cookie', adminCookie),
      200,
    );
    await expectContract(
      'POST /api/auth/login',
      request(app).post('/api/auth/login').send({ email: ADMIN.email, password: 'otra-clave-12' }),
      401,
    );
  });

  it('bodegas y productos', async () => {
    const a = await expectContract(
      'POST /api/warehouses',
      request(app).post('/api/warehouses').set(as('ADMIN')).send({ code: 'A', name: 'Bodega A' }),
      201,
    );
    warehouseA = a.body.id;
    const b = await expectContract(
      'POST /api/warehouses',
      request(app).post('/api/warehouses').set(as('ADMIN')).send({ code: 'B', name: 'Bodega B' }),
      201,
    );
    warehouseB = b.body.id;
    await expectContract(
      'PUT /api/warehouses/{id}',
      request(app)
        .put(`/api/warehouses/${warehouseB}`)
        .set(as('ADMIN'))
        .send({ code: 'B', name: 'Bodega Bello' }),
      200,
    );
    await expectContract(
      'GET /api/warehouses',
      request(app).get('/api/warehouses').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'GET /api/warehouses/destinations',
      request(app).get('/api/warehouses/destinations').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'POST /api/warehouses',
      request(app).post('/api/warehouses').set(as('ADMIN')).send({ code: '' }),
      400,
    );

    const p = await expectContract(
      'POST /api/products',
      request(app)
        .post('/api/products')
        .set(as('ADMIN'))
        .send({ sku: 'SKU-1', name: 'Tornillo', unit: 'un' }),
      201,
    );
    product = p.body.id;
    await expectContract(
      'PUT /api/products/{id}',
      request(app)
        .put(`/api/products/${product}`)
        .set(as('ADMIN'))
        .send({ sku: 'SKU-1', name: 'Tornillo 1/4', unit: 'un' }),
      200,
    );
    await expectContract(
      'GET /api/products',
      request(app).get('/api/products').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'PUT /api/products/{id}',
      request(app)
        .put(`/api/products/${MISSING_ID}`)
        .set(as('ADMIN'))
        .send({ sku: 'SKU-9', name: 'No existe', unit: 'un' }),
      404,
    );
  });

  it('usuarios', async () => {
    const createUser = async (who: Who, role: string, warehouseId: string): Promise<string> => {
      const email = `${who.toLowerCase()}@example.com`;
      const created = await expectContract(
        'POST /api/users',
        request(app)
          .post('/api/users')
          .set(as('ADMIN'))
          .send({ email, name: who, role, password: PASSWORD }),
        201,
      );
      await expectContract(
        'PUT /api/users/{id}/warehouses',
        request(app)
          .put(`/api/users/${created.body.id}/warehouses`)
          .set(as('ADMIN'))
          .send({ warehouseIds: [warehouseId] }),
        200,
      );
      tokens[who] = await login(email);
      return created.body.id;
    };
    await createUser('MANAGER_A', 'WAREHOUSE_MANAGER', warehouseA);
    await createUser('MANAGER_B', 'WAREHOUSE_MANAGER', warehouseB);
    operatorId = await createUser('OPERATOR_A', 'OPERATOR', warehouseA);

    await expectContract(
      'PUT /api/users/{id}',
      request(app).put(`/api/users/${operatorId}`).set(as('ADMIN')).send({
        email: 'operator_a@example.com',
        name: 'Operario A',
        role: 'OPERATOR',
        active: true,
      }),
      200,
    );
    await expectContract('GET /api/users', request(app).get('/api/users').set(as('ADMIN')), 200);
    await expectContract(
      'GET /api/users',
      request(app).get('/api/users').set(as('OPERATOR_A')),
      403,
    );
  });

  it('entradas, mermas y consultas de stock (con y sin costos)', async () => {
    const entry = (quantity: number, unitCost: string) =>
      request(app)
        .post('/api/stock/entries')
        .set(as('ADMIN'))
        .send({ warehouseId: warehouseA, productId: product, quantity, unitCost });
    await expectContract('POST /api/stock/entries', entry(10, '100'), 201);
    await expectContract('POST /api/stock/entries', entry(10, '120.5'), 201);

    const shrinkage = (who: Who) =>
      request(app)
        .post('/api/stock/shrinkage')
        .set(as(who))
        .send({ warehouseId: warehouseA, productId: product, quantity: 1, reason: 'DAMAGE' });
    await expectContract('POST /api/stock/shrinkage', shrinkage('MANAGER_A'), 201);
    await expectContract('POST /api/stock/shrinkage', shrinkage('OPERATOR_A'), 201);
    await expectContract(
      'POST /api/stock/shrinkage',
      request(app)
        .post('/api/stock/shrinkage')
        .set(as('MANAGER_A'))
        .send({ warehouseId: warehouseA, productId: product, quantity: 1000, reason: 'THEFT' }),
      409,
    );

    for (const who of ['ADMIN', 'OPERATOR_A'] as const) {
      await expectContract(
        'GET /api/stock',
        request(app).get('/api/stock').query({ warehouseId: warehouseA }).set(as(who)),
        200,
      );
      await expectContract(
        'GET /api/stock/movements',
        request(app)
          .get('/api/stock/movements')
          .query({ warehouseId: warehouseA, limit: 2 })
          .set(as(who)),
        200,
      );
    }
    await expectContract(
      'GET /api/stock',
      request(app).get('/api/stock').query({ warehouseId: warehouseB }).set(as('OPERATOR_A')),
      403,
    );
  });

  it('traspasos en todos sus estados', async () => {
    const draft = await expectContract(
      'POST /api/transfers',
      request(app)
        .post('/api/transfers')
        .set(as('MANAGER_A'))
        .send({
          originWarehouseId: warehouseA,
          destinationWarehouseId: warehouseB,
          items: [{ productId: product, quantity: 1 }],
          note: 'Se cancela',
        }),
      201,
    );
    await expectContract(
      'POST /api/transfers/{id}/cancel',
      request(app)
        .post(`/api/transfers/${draft.body.id}/cancel`)
        .set(as('MANAGER_A'))
        .send({ reason: 'Ya no hace falta' }),
      200,
    );

    const created = await request(app)
      .post('/api/transfers')
      .set(as('MANAGER_A'))
      .send({
        originWarehouseId: warehouseA,
        destinationWarehouseId: warehouseB,
        items: [{ productId: product, quantity: 5 }],
      });
    const id: string = created.body.id;
    await expectContract(
      'POST /api/transfers/{id}/dispatch',
      request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')),
      200,
    );
    await expectContract(
      'POST /api/transfers/{id}/dispatch',
      request(app).post(`/api/transfers/${id}/dispatch`).set(as('MANAGER_A')),
      409,
    );
    await expectContract(
      'POST /api/transfers/{id}/receive',
      request(app)
        .post(`/api/transfers/${id}/receive`)
        .set(as('MANAGER_B'))
        .send({ items: [{ productId: product, receivedQuantity: 4 }] }),
      200,
    );
    await expectContract(
      'POST /api/transfers/{id}/resolve',
      request(app)
        .post(`/api/transfers/${id}/resolve`)
        .set(as('ADMIN'))
        .send({ reason: 'Se perdió en ruta' }),
      200,
    );

    // Uno queda en tránsito para el reporte
    await dispatchAtoB(2);

    for (const who of ['MANAGER_A', 'OPERATOR_A'] as const) {
      await expectContract(
        'GET /api/transfers/{id}',
        request(app).get(`/api/transfers/${id}`).set(as(who)),
        200,
      );
    }
    await expectContract(
      'GET /api/transfers',
      request(app).get('/api/transfers').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'GET /api/transfers/{id}',
      request(app).get(`/api/transfers/${MISSING_ID}`).set(as('ADMIN')),
      404,
    );
  });

  it('reportes, dashboard y tiempo real', async () => {
    await expectContract(
      'GET /api/reports/kardex',
      request(app)
        .get('/api/reports/kardex')
        .query({ warehouseId: warehouseA, productId: product })
        .set(as('ADMIN')),
      200,
    );
    await expectContract(
      'GET /api/reports/shrinkage',
      request(app).get('/api/reports/shrinkage').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'GET /api/reports/in-transit',
      request(app).get('/api/reports/in-transit').set(as('ADMIN')),
      200,
    );
    await expectContract(
      'GET /api/reports/summary',
      request(app).get('/api/reports/summary').set(as('MANAGER_A')),
      200,
    );
    await expectContract(
      'GET /api/reports/summary',
      request(app).get('/api/reports/summary').set(as('OPERATOR_A')),
      403,
    );
    await expectContract(
      'POST /api/realtime/ticket',
      request(app).post('/api/realtime/ticket').set(as('OPERATOR_A')),
      201,
    );
  });

  it('todos los endpoints con respuesta JSON del contrato pasaron por esta prueba', () => {
    expect(jsonOperations().filter((operation) => !checked.has(operation))).toEqual([]);
  });

  it('cada referencia del contrato apunta a un esquema que existe', () => {
    const refs = JSON.stringify(buildOpenApiSpec()).match(/#\/components\/schemas\/[A-Za-z]+/g);
    const missing = (refs ?? []).filter((ref) => !schemasByName.has(ref.split('/').at(-1) ?? ''));
    expect(missing).toEqual([]);
  });
});
