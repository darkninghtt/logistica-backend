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

async function createWarehouse(code: string, name = `Bodega ${code}`): Promise<string> {
  const res = await request(app).post('/api/warehouses').set(auth()).send({ code, name });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe('POST /api/warehouses', () => {
  it('crea la bodega (activa por defecto) y devuelve el recurso', async () => {
    const res = await request(app)
      .post('/api/warehouses')
      .set(auth())
      .send({ code: 'BOD-A', name: 'Bodega A' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ code: 'BOD-A', name: 'Bodega A', active: true });
    expect(typeof res.body.id).toBe('string');
    expect(typeof res.body.createdAt).toBe('string');
  });

  it('un código repetido da 409 con el formato de error (sin distinguir mayúsculas)', async () => {
    await createWarehouse('BOD-A');

    const res = await request(app)
      .post('/api/warehouses')
      .set(auth())
      .set('x-correlation-id', 'abc-123')
      .send({ code: 'bod-a', name: 'Otra' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      code: 'CONFLICT',
      message: 'Ya existe una bodega con ese código',
      correlationId: 'abc-123',
    });
  });

  it('datos inválidos dan 400 con el formato de error', async () => {
    const res = await request(app).post('/api/warehouses').set(auth()).send({ name: 'Sin código' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(typeof res.body.correlationId).toBe('string');
  });

  it('sin token da 401', async () => {
    const res = await request(app).post('/api/warehouses').send({ code: 'A', name: 'A' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/warehouses', () => {
  it('lista vacía cuando no hay bodegas', async () => {
    const res = await request(app).get('/api/warehouses').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], page: 1, pageSize: 20, total: 0 });
  });

  it('pagina y ordena por código', async () => {
    for (const code of ['C', 'A', 'E', 'B', 'D']) {
      await createWarehouse(code);
    }

    const first = await request(app).get('/api/warehouses?page=1&pageSize=2').set(auth());
    const last = await request(app).get('/api/warehouses?page=3&pageSize=2').set(auth());

    expect(first.body.total).toBe(5);
    expect(first.body.page).toBe(1);
    expect(first.body.pageSize).toBe(2);
    expect(first.body.data.map((w: { code: string }) => w.code)).toEqual(['A', 'B']);
    expect(last.body.data.map((w: { code: string }) => w.code)).toEqual(['E']);
  });

  it('parámetros de paginación inválidos dan 400', async () => {
    const res = await request(app).get('/api/warehouses?pageSize=1000').set(auth());
    expect(res.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app).get('/api/warehouses');
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/warehouses/:id', () => {
  it('edita la bodega y permite desactivarla', async () => {
    const id = await createWarehouse('BOD-A');

    const res = await request(app)
      .put(`/api/warehouses/${id}`)
      .set(auth())
      .send({ code: 'BOD-A', name: 'Nombre nuevo', active: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, code: 'BOD-A', name: 'Nombre nuevo', active: false });
  });

  it('puede conservar su propio código', async () => {
    const id = await createWarehouse('BOD-A');
    const res = await request(app)
      .put(`/api/warehouses/${id}`)
      .set(auth())
      .send({ code: 'BOD-A', name: 'Otro nombre' });
    expect(res.status).toBe(200);
  });

  it('usar el código de otra bodega da 409', async () => {
    await createWarehouse('BOD-A');
    const id = await createWarehouse('BOD-B');

    const res = await request(app)
      .put(`/api/warehouses/${id}`)
      .set(auth())
      .send({ code: 'BOD-A', name: 'B' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('una bodega inexistente da 404', async () => {
    const res = await request(app)
      .put('/api/warehouses/0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11')
      .set(auth())
      .send({ code: 'X', name: 'X' });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('un id que no es UUID da 400', async () => {
    const res = await request(app)
      .put('/api/warehouses/123')
      .set(auth())
      .send({ code: 'X', name: 'X' });
    expect(res.status).toBe(400);
  });

  it('datos inválidos dan 400', async () => {
    const id = await createWarehouse('BOD-A');
    const res = await request(app).put(`/api/warehouses/${id}`).set(auth()).send({ code: '' });
    expect(res.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app)
      .put('/api/warehouses/0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11')
      .send({ code: 'X', name: 'X' });
    expect(res.status).toBe(401);
  });
});

describe('documentación', () => {
  it('Swagger documenta los endpoints de bodegas', async () => {
    const res = await request(app).get('/api-docs.json');

    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/api/warehouses', '/api/warehouses/{id}']),
    );
  });
});
