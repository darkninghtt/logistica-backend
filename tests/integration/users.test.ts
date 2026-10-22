import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const PASSWORD = 'Clave-segura-123';
const NEW_USER = {
  email: 'jefe@example.com',
  name: 'Jefe',
  role: 'WAREHOUSE_MANAGER',
  password: PASSWORD,
};
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

let token: string;

async function login(email: string, password: string): Promise<request.Response> {
  return request(app).post('/api/auth/login').send({ email, password });
}

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
  token = (await login(ADMIN.email, ADMIN.password)).body.accessToken;
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

function auth(t = token): { Authorization: string } {
  return { Authorization: `Bearer ${t}` };
}

async function createUser(body: object = NEW_USER): Promise<request.Response> {
  return request(app).post('/api/users').set(auth()).send(body);
}

async function createWarehouse(code: string): Promise<string> {
  const res = await request(app)
    .post('/api/warehouses')
    .set(auth())
    .send({ code, name: `Bodega ${code}` });
  return res.body.id;
}

/** Crea un usuario con ese rol y devuelve su token de acceso. */
async function tokenFor(role: string): Promise<string> {
  const email = `${role.toLowerCase()}@example.com`;
  await createUser({ ...NEW_USER, email, role });
  return (await login(email, PASSWORD)).body.accessToken;
}

describe('POST /api/users', () => {
  it('crea el usuario con rol y contraseña inicial, sin devolver el hash', async () => {
    const res = await createUser();

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      email: 'jefe@example.com',
      name: 'Jefe',
      role: 'WAREHOUSE_MANAGER',
      active: true,
      warehouseIds: [],
    });
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password');
    expect(JSON.stringify(res.body)).not.toContain('argon2');
  });

  it('guarda solo el hash y el usuario nuevo puede iniciar sesión', async () => {
    await createUser();

    const { rows } = await pool.query<{ password_hash: string }>(
      "SELECT password_hash FROM users WHERE email = 'jefe@example.com'",
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.password_hash).not.toContain(PASSWORD);
    expect((await login('jefe@example.com', PASSWORD)).status).toBe(200);
  });

  it('un correo repetido da 409, sin distinguir mayúsculas', async () => {
    await createUser();

    const res = await createUser({ ...NEW_USER, email: 'JEFE@Example.com' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CONFLICT');
  });

  it('un rol inválido da 400', async () => {
    const res = await createUser({ ...NEW_USER, role: 'SUPERMAN' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it.each([
    ['sin correo', { name: 'X', role: 'OPERATOR', password: PASSWORD }],
    ['correo inválido', { ...NEW_USER, email: 'no-es-correo' }],
    ['contraseña corta', { ...NEW_USER, password: 'corta' }],
    ['sin nombre', { ...NEW_USER, name: '' }],
  ])('datos inválidos (%s) dan 400', async (_label, body) => {
    const res = await createUser(body);
    expect(res.status).toBe(400);
  });

  it('sin token da 401', async () => {
    const res = await request(app).post('/api/users').send(NEW_USER);
    expect(res.status).toBe(401);
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR'])('el rol %s recibe 403', async (role) => {
    const res = await request(app)
      .post('/api/users')
      .set(auth(await tokenFor(role)))
      .send({
        ...NEW_USER,
        email: 'otro@example.com',
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('GET /api/users', () => {
  it('lista paginada por correo, con bodegas asignadas y sin hashes', async () => {
    const warehouseId = await createWarehouse('BOD-A');
    const created = await createUser();
    await request(app)
      .put(`/api/users/${created.body.id}/warehouses`)
      .set(auth())
      .send({ warehouseIds: [warehouseId] });

    const res = await request(app).get('/api/users?pageSize=1').set(auth());

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ page: 1, pageSize: 1, total: 2 });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].email).toBe('admin@example.com');

    const second = await request(app).get('/api/users?page=2&pageSize=1').set(auth());
    expect(second.body.data[0]).toMatchObject({
      email: 'jefe@example.com',
      warehouseIds: [warehouseId],
    });
    expect(JSON.stringify([res.body, second.body])).not.toMatch(
      /passwordHash|password_hash|argon2/,
    );
  });

  it('paginación inválida da 400', async () => {
    expect((await request(app).get('/api/users?pageSize=1000').set(auth())).status).toBe(400);
  });

  it('sin token da 401', async () => {
    expect((await request(app).get('/api/users')).status).toBe(401);
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR'])('el rol %s recibe 403', async (role) => {
    const res = await request(app)
      .get('/api/users')
      .set(auth(await tokenFor(role)));
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/users/:id', () => {
  it('edita los datos y puede desactivar al usuario', async () => {
    const { body: user } = await createUser();

    const res = await request(app).put(`/api/users/${user.id}`).set(auth()).send({
      email: 'nuevo@example.com',
      name: 'Nombre nuevo',
      role: 'AUDITOR',
      active: false,
    });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      email: 'nuevo@example.com',
      name: 'Nombre nuevo',
      role: 'AUDITOR',
      active: false,
    });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('sin enviar contraseña se conserva la actual; enviándola, cambia', async () => {
    const { body: user } = await createUser();
    const base = { email: user.email, name: user.name, role: user.role, active: true };

    await request(app).put(`/api/users/${user.id}`).set(auth()).send(base);
    expect((await login(user.email, PASSWORD)).status).toBe(200);

    await request(app)
      .put(`/api/users/${user.id}`)
      .set(auth())
      .send({ ...base, password: 'Otra-clave-segura-1' });
    expect((await login(user.email, PASSWORD)).status).toBe(401);
    expect((await login(user.email, 'Otra-clave-segura-1')).status).toBe(200);
  });

  it('un usuario desactivado no puede iniciar sesión', async () => {
    const { body: user } = await createUser();
    await request(app)
      .put(`/api/users/${user.id}`)
      .set(auth())
      .send({ email: user.email, name: user.name, role: user.role, active: false });

    expect((await login(user.email, PASSWORD)).status).toBe(401);
  });

  it('usar el correo de otro usuario da 409', async () => {
    const { body: user } = await createUser();
    const res = await request(app)
      .put(`/api/users/${user.id}`)
      .set(auth())
      .send({ email: 'ADMIN@example.com', name: 'X', role: 'OPERATOR', active: true });
    expect(res.status).toBe(409);
  });

  it('un usuario inexistente da 404', async () => {
    const res = await request(app)
      .put(`/api/users/${MISSING_ID}`)
      .set(auth())
      .send({ email: 'x@example.com', name: 'X', role: 'OPERATOR', active: true });
    expect(res.status).toBe(404);
  });

  it('datos o identificador inválidos dan 400', async () => {
    const { body: user } = await createUser();
    const invalidRole = await request(app)
      .put(`/api/users/${user.id}`)
      .set(auth())
      .send({ email: user.email, name: 'X', role: 'SUPERMAN', active: true });
    const invalidId = await request(app)
      .put('/api/users/no-es-uuid')
      .set(auth())
      .send({ email: user.email, name: 'X', role: 'OPERATOR', active: true });
    expect(invalidRole.status).toBe(400);
    expect(invalidId.status).toBe(400);
  });

  it('sin token da 401 y con otro rol da 403', async () => {
    const body = { email: 'x@example.com', name: 'X', role: 'OPERATOR', active: true };
    const noToken = await request(app).put(`/api/users/${MISSING_ID}`).send(body);
    const operator = await request(app)
      .put(`/api/users/${MISSING_ID}`)
      .set(auth(await tokenFor('OPERATOR')))
      .send(body);
    expect(noToken.status).toBe(401);
    expect(operator.status).toBe(403);
  });
});

describe('PUT /api/users/:id/warehouses', () => {
  it('reemplaza la lista de bodegas asignadas', async () => {
    const [a, b, c] = [
      await createWarehouse('BOD-A'),
      await createWarehouse('BOD-B'),
      await createWarehouse('BOD-C'),
    ];
    const { body: user } = await createUser();
    const put = (warehouseIds: string[]): request.Test =>
      request(app).put(`/api/users/${user.id}/warehouses`).set(auth()).send({ warehouseIds });

    const first = await put([a, b]);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ userId: user.id, warehouseIds: [a, b].sort() });

    const second = await put([b, c, c]);
    expect(second.body.warehouseIds).toEqual([b, c].sort());

    const stored = await request(app).get('/api/users?pageSize=100').set(auth());
    const found = stored.body.data.find((u: { id: string }) => u.id === user.id);
    expect(found.warehouseIds).toEqual([b, c].sort());

    const emptied = await put([]);
    expect(emptied.body.warehouseIds).toEqual([]);
  });

  it('una bodega inexistente da 404 y no cambia lo que había', async () => {
    const a = await createWarehouse('BOD-A');
    const { body: user } = await createUser();
    await request(app)
      .put(`/api/users/${user.id}/warehouses`)
      .set(auth())
      .send({ warehouseIds: [a] });

    const res = await request(app)
      .put(`/api/users/${user.id}/warehouses`)
      .set(auth())
      .send({ warehouseIds: [MISSING_ID] });

    expect(res.status).toBe(404);
    const { rows } = await pool.query(
      'SELECT warehouse_id FROM user_warehouses WHERE user_id = $1',
      [user.id],
    );
    expect(rows.map((r: { warehouse_id: string }) => r.warehouse_id)).toEqual([a]);
  });

  it('un usuario inexistente da 404', async () => {
    const res = await request(app)
      .put(`/api/users/${MISSING_ID}/warehouses`)
      .set(auth())
      .send({ warehouseIds: [] });
    expect(res.status).toBe(404);
  });

  it('datos inválidos dan 400', async () => {
    const { body: user } = await createUser();
    const notList = await request(app)
      .put(`/api/users/${user.id}/warehouses`)
      .set(auth())
      .send({ warehouseIds: 'x' });
    const notUuid = await request(app)
      .put(`/api/users/${user.id}/warehouses`)
      .set(auth())
      .send({ warehouseIds: ['no-es-uuid'] });
    expect(notList.status).toBe(400);
    expect(notUuid.status).toBe(400);
  });

  it('sin token da 401 y con otro rol da 403', async () => {
    const noToken = await request(app)
      .put(`/api/users/${MISSING_ID}/warehouses`)
      .send({ warehouseIds: [] });
    const manager = await request(app)
      .put(`/api/users/${MISSING_ID}/warehouses`)
      .set(auth(await tokenFor('WAREHOUSE_MANAGER')))
      .send({ warehouseIds: [] });
    expect(noToken.status).toBe(401);
    expect(manager.status).toBe(403);
  });
});
