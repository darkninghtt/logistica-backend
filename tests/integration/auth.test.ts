import jwt from 'jsonwebtoken';
import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin, TEST_JWT_SECRET } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

async function loginAsAdmin(): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({
    email: ADMIN.email,
    password: ADMIN.password,
  });
  return res.body.accessToken;
}

describe('POST /api/auth/login', () => {
  it('con credenciales correctas devuelve el token y el usuario (sin hash)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password });

    expect(res.status).toBe(200);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.user).toMatchObject({ email: ADMIN.email, name: ADMIN.name, role: 'ADMIN' });
    expect(typeof res.body.user.id).toBe('string');
    expect(res.text).not.toMatch(/argon2|passwordHash|password_hash/);
  });

  it('acepta el correo con otras mayúsculas', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ADMIN@Example.com', password: ADMIN.password });
    expect(res.status).toBe(200);
  });

  it('contraseña incorrecta y correo inexistente dan 401 con exactamente la misma respuesta', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .set('x-correlation-id', 'same-id')
      .send({ email: ADMIN.email, password: 'incorrecta' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .set('x-correlation-id', 'same-id')
      .send({ email: 'nadie@example.com', password: ADMIN.password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
    expect(wrongPassword.body.code).toBe('UNAUTHORIZED');
  });

  it.each([
    ['sin cuerpo', undefined],
    ['sin contraseña', { email: ADMIN.email }],
    ['correo inválido', { email: 'no-es-correo', password: 'x' }],
    ['tipos incorrectos', { email: 1, password: 2 }],
  ])('un cuerpo inválido (%s) da 400 con el formato de error', async (_name, body) => {
    const req = request(app).post('/api/auth/login').set('x-correlation-id', 'val-1');
    const res = body === undefined ? await req : await req.send(body);

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', correlationId: 'val-1' });
    expect(typeof res.body.message).toBe('string');
  });

  it('la contraseña en la BD es un hash argon2id, no el texto plano', async () => {
    const { rows } = await pool.query<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      [ADMIN.email],
    );
    expect(rows[0]?.password_hash).toMatch(/^\$argon2id\$/);
    expect(rows[0]?.password_hash).not.toContain(ADMIN.password);
  });
});

describe('protección de /api', () => {
  it('GET /api/auth/me sin token da 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('con un token válido pasa y devuelve el usuario', async () => {
    const token = await loginAsAdmin();
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
  });

  it('cualquier otra ruta de /api exige token: sin token 401, con token pasa a 404', async () => {
    const anonymous = await request(app).get('/api/lo-que-sea');
    expect(anonymous.status).toBe(401);

    const token = await loginAsAdmin();
    const authenticated = await request(app)
      .get('/api/lo-que-sea')
      .set('Authorization', `Bearer ${token}`);
    expect(authenticated.status).toBe(404);
  });

  it.each([
    ['esquema distinto de Bearer', 'Basic abc'],
    ['token basura', 'Bearer basura'],
    ['token vacío', 'Bearer '],
  ])('rechaza %s con 401', async (_name, header) => {
    const res = await request(app).get('/api/auth/me').set('Authorization', header);
    expect(res.status).toBe(401);
  });

  it('rechaza un token expirado y uno firmado con otro secreto', async () => {
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM users LIMIT 1');
    const id = rows[0]?.id ?? '';

    const expired = jwt.sign({ role: 'ADMIN' }, TEST_JWT_SECRET, { subject: id, expiresIn: -5 });
    const forged = jwt.sign({ role: 'ADMIN' }, 'otro-secreto-que-no-es-el-del-servidor-123', {
      subject: id,
    });

    for (const token of [expired, forged]) {
      const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('un token válido de un usuario que ya no existe da 401', async () => {
    const token = await loginAsAdmin();
    await pool.query('DELETE FROM refresh_tokens');
    await pool.query('DELETE FROM users');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('/health sigue siendo público', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
  });
});

describe('Swagger', () => {
  it('/api-docs responde con la interfaz de Swagger UI', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger-ui');
  });

  it('la especificación documenta el login y el esquema de errores', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.paths['/api/auth/login'].post.summary).toBeTruthy();
    expect(res.body.paths['/api/auth/me'].get).toBeTruthy();
    expect(res.body.components.schemas.ErrorResponse).toBeTruthy();
  });
});
