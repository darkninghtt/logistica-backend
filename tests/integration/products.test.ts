import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

let token: string;

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.password });
  token = res.body.accessToken;
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

function auth(): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

async function createProduct(sku: string, name = `Producto ${sku}`): Promise<string> {
  const res = await request(app).post('/api/products').set(auth()).send({ sku, name, unit: 'un' });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe('POST /api/products', () => {
  it('crea el producto y devuelve el recurso', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth())
      .send({ sku: 'SKU-001', name: 'Tornillo', unit: 'un' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ sku: 'SKU-001', name: 'Tornillo', unit: 'un' });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('un SKU repetido da 409 con un mensaje claro (sin distinguir mayúsculas)', async () => {
    await createProduct('SKU-001');

    const res = await request(app)
      .post('/api/products')
      .set(auth())
      .set('x-correlation-id', 'abc-123')
      .send({ sku: 'sku-001', name: 'Otro', unit: 'kg' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'CONFLICT',
      message: 'Ya existe un producto con ese SKU',
      correlationId: 'abc-123',
    });
  });

  it('datos inválidos dan 400 con el formato de error', async () => {
    const res = await request(app)
      .post('/api/products')
      .set(auth())
      .send({ sku: 'A', name: 'Sin unidad' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.correlationId).toBe('string');
  });

  it('sin token da 401', async () => {
    const res = await request(app).post('/api/products').send({ sku: 'A', name: 'A', unit: 'un' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/products', () => {
  it('lista vacía cuando no hay productos', async () => {
    const res = await request(app).get('/api/products').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  it('pagina y ordena por SKU', async () => {
    for (const sku of ['C', 'A', 'E', 'B', 'D']) {
      await createProduct(sku);
    }

    const first = await request(app).get('/api/products?page=1&pageSize=2').set(auth());
    const last = await request(app).get('/api/products?page=3&pageSize=2').set(auth());

    expect(first.body.total).toBe(5);
    expect(first.body.page).toBe(1);
    expect(first.body.pageSize).toBe(2);
    expect(first.body.data.map((p: { sku: string }) => p.sku)).toEqual(['A', 'B']);
    expect(last.body.data.map((p: { sku: string }) => p.sku)).toEqual(['E']);
  });

  it('parámetros de paginación inválidos dan 400', async () => {
    const res = await request(app).get('/api/products?pageSize=1000').set(auth());
    expect(res.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app).get('/api/products');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/products/:id', () => {
  it('edita el producto', async () => {
    const id = await createProduct('SKU-001');

    const res = await request(app)
      .put(`/api/products/${id}`)
      .set(auth())
      .send({ sku: 'SKU-001', name: 'Nombre nuevo', unit: 'kg' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, sku: 'SKU-001', name: 'Nombre nuevo', unit: 'kg' });
  });

  it('puede conservar su propio SKU', async () => {
    const id = await createProduct('SKU-001');
    const res = await request(app)
      .put(`/api/products/${id}`)
      .set(auth())
      .send({ sku: 'SKU-001', name: 'Otro nombre', unit: 'un' });
    expect(res.status).toBe(200);
  });

  it('usar el SKU de otro producto da 409', async () => {
    await createProduct('SKU-001');
    const id = await createProduct('SKU-002');

    const res = await request(app)
      .put(`/api/products/${id}`)
      .set(auth())
      .send({ sku: 'SKU-001', name: 'B', unit: 'un' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('un producto inexistente da 404', async () => {
    const res = await request(app)
      .put('/api/products/0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11')
      .set(auth())
      .send({ sku: 'X', name: 'X', unit: 'un' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('un id que no es UUID da 400', async () => {
    const res = await request(app)
      .put('/api/products/123')
      .set(auth())
      .send({ sku: 'X', name: 'X', unit: 'un' });
    expect(res.status).toBe(400);
  });

  it('datos inválidos dan 400', async () => {
    const id = await createProduct('SKU-001');
    const res = await request(app).put(`/api/products/${id}`).set(auth()).send({ sku: '' });
    expect(res.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app)
      .put('/api/products/0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11')
      .send({ sku: 'X', name: 'X', unit: 'un' });
    expect(res.status).toBe(401);
  });
});

describe('documentación', () => {
  it('Swagger documenta los endpoints de productos', async () => {
    const res = await request(app).get('/api-docs.json');

    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/products', '/api/products/{id}']),
    );
  });
});
