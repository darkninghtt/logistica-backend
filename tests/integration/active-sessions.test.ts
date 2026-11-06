import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const { app } = buildTestApp(pool);

const OPERATOR = { email: 'operario@example.com', password: 'Clave-operario-123' };
const FIREFOX = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const CHROME = 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

interface Session {
  cookie: string;
  accessToken: string;
}

function refreshCookie(res: request.Response): string {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : [];
  const value = cookies.find((c) => c.startsWith('refresh_token='))?.split(';')[0];
  if (!value) throw new Error('La respuesta no trae la cookie refresh_token');
  return value;
}

async function login(
  credentials: { email: string; password: string },
  userAgent = CHROME,
): Promise<Session> {
  const res = await request(app)
    .post('/api/auth/login')
    .set('User-Agent', userAgent)
    .send(credentials);
  expect(res.status).toBe(200);
  return { cookie: refreshCookie(res), accessToken: res.body.accessToken };
}

function refresh(session: Session): request.Test {
  return request(app).post('/api/auth/refresh').set('Cookie', session.cookie);
}

function listSessions(session: Session): request.Test {
  return request(app)
    .get('/api/auth/sessions')
    .set('Authorization', `Bearer ${session.accessToken}`)
    .set('Cookie', session.cookie);
}

async function createOperator(admin: Session): Promise<string> {
  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${admin.accessToken}`)
    .send({ ...OPERATOR, name: 'Operario', role: 'OPERATOR' });
  expect(res.status).toBe(201);
  return res.body.id;
}

describe('GET /api/auth/sessions', () => {
  it('lista solo las sesiones propias activas, con su navegador, y marca la actual', async () => {
    const chrome = await login(ADMIN, CHROME);
    const firefox = await login(ADMIN, FIREFOX);
    await createOperator(chrome);
    await login(OPERATOR);
    const closed = await login(ADMIN, 'Navegador cerrado');
    await request(app).post('/api/auth/logout').set('Cookie', closed.cookie);

    const res = await listSessions(firefox);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.map((s: { userAgent: string }) => s.userAgent).sort()).toEqual(
      [CHROME, FIREFOX].sort(),
    );
    const current = res.body.filter((s: { current: boolean }) => s.current);
    expect(current).toHaveLength(1);
    expect(current[0]).toMatchObject({ userAgent: FIREFOX });
    expect(current[0].createdAt).toEqual(expect.any(String));
    expect(current[0].lastUsedAt).toEqual(expect.any(String));
  });

  it('una sesión renovada sigue siendo la misma (no aparece dos veces)', async () => {
    const session = await login(ADMIN);
    const renewed = await refresh(session);
    expect(renewed.status).toBe(200);

    const res = await listSessions({
      cookie: refreshCookie(renewed),
      accessToken: renewed.body.accessToken,
    });
    expect(res.body).toHaveLength(1);
    expect(res.body[0].current).toBe(true);
  });

  it('sin access token da 401', async () => {
    expect((await request(app).get('/api/auth/sessions')).status).toBe(401);
  });
});

describe('DELETE /api/auth/sessions/:id', () => {
  it('cerrar una sesión hace que su refresh dé 401; la actual sigue', async () => {
    const other = await login(ADMIN, FIREFOX);
    const mine = await login(ADMIN, CHROME);
    const sessions = (await listSessions(mine)).body;
    const target = sessions.find((s: { current: boolean }) => !s.current);

    const res = await request(app)
      .delete(`/api/auth/sessions/${target.id}`)
      .set('Authorization', `Bearer ${mine.accessToken}`);

    expect(res.status).toBe(204);
    expect((await refresh(other)).status).toBe(401);
    expect((await refresh(mine)).status).toBe(200);
  });

  it('cerrar una sesión ajena da 404 y no la toca', async () => {
    const admin = await login(ADMIN);
    await createOperator(admin);
    const operator = await login(OPERATOR);
    const [operatorSession] = (await listSessions(operator)).body;

    const res = await request(app)
      .delete(`/api/auth/sessions/${operatorSession.id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
    expect((await refresh(operator)).status).toBe(200);
  });

  it('una sesión inexistente da 404 y un id inválido da 400', async () => {
    const admin = await login(ADMIN);
    const missing = await request(app)
      .delete('/api/auth/sessions/00000000-0000-4000-8000-000000000000')
      .set('Authorization', `Bearer ${admin.accessToken}`);
    const invalid = await request(app)
      .delete('/api/auth/sessions/no-es-uuid')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(400);
  });
});

describe('POST /api/auth/logout-all', () => {
  it('revoca todas las sesiones del usuario y borra la cookie', async () => {
    const a = await login(ADMIN, CHROME);
    const b = await login(ADMIN, FIREFOX);

    const res = await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${a.accessToken}`)
      .set('Cookie', a.cookie);

    expect(res.status).toBe(204);
    const cleared = res.headers['set-cookie'];
    expect(Array.isArray(cleared) ? cleared.join(';') : '').toMatch(/refresh_token=;/);
    expect((await refresh(a)).status).toBe(401);
    expect((await refresh(b)).status).toBe(401);
  });

  it('no toca las sesiones de otros usuarios', async () => {
    const admin = await login(ADMIN);
    await createOperator(admin);
    const operator = await login(OPERATOR);

    await request(app)
      .post('/api/auth/logout-all')
      .set('Authorization', `Bearer ${admin.accessToken}`);

    expect((await refresh(operator)).status).toBe(200);
  });
});

describe('PUT /api/auth/password', () => {
  const NEW_PASSWORD = 'Nueva-clave-segura-2026';

  function changePassword(session: Session, currentPassword: string): request.Test {
    return request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .set('Cookie', session.cookie)
      .send({ currentPassword, newPassword: NEW_PASSWORD });
  }

  it('con la actual incorrecta da 400 y no cambia nada', async () => {
    const session = await login(ADMIN);
    const other = await login(ADMIN, FIREFOX);

    const res = await changePassword(session, 'no-es-la-actual');

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect((await refresh(other)).status).toBe(200);
    await login(ADMIN);
  });

  it('con la correcta cambia la contraseña y revoca las demás sesiones, no la actual', async () => {
    const mine = await login(ADMIN, CHROME);
    const other = await login(ADMIN, FIREFOX);

    const res = await changePassword(mine, ADMIN.password);

    expect(res.status).toBe(204);
    expect((await refresh(other)).status).toBe(401);
    expect((await refresh(mine)).status).toBe(200);
    const oldPassword = await request(app).post('/api/auth/login').send(ADMIN);
    expect(oldPassword.status).toBe(401);
    await login({ email: ADMIN.email, password: NEW_PASSWORD });
  });

  it('una contraseña nueva corta da 400', async () => {
    const session = await login(ADMIN);
    const res = await request(app)
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: ADMIN.password, newPassword: 'corta' });
    expect(res.status).toBe(400);
  });

  it('sin access token da 401', async () => {
    const res = await request(app)
      .put('/api/auth/password')
      .send({ currentPassword: ADMIN.password, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(401);
  });
});

describe('/api/users: revocar sesiones', () => {
  async function updateOperator(admin: Session, id: string, changes: object) {
    return request(app)
      .put(`/api/users/${id}`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({
        email: OPERATOR.email,
        name: 'Operario',
        role: 'OPERATOR',
        active: true,
        ...changes,
      });
  }

  it('desactivar a un usuario revoca sus sesiones', async () => {
    const admin = await login(ADMIN);
    const id = await createOperator(admin);
    const operator = await login(OPERATOR);

    expect((await updateOperator(admin, id, { active: false })).status).toBe(200);

    expect((await refresh(operator)).status).toBe(401);
    const { rows } = await pool.query(
      'SELECT count(*)::int AS open FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL',
      [id],
    );
    expect(rows[0].open).toBe(0);
  });

  it('cambiarle la contraseña revoca sus sesiones; editar el nombre no', async () => {
    const admin = await login(ADMIN);
    const id = await createOperator(admin);
    const operator = await login(OPERATOR);

    await updateOperator(admin, id, { name: 'Operario renombrado' });
    const renewed = await refresh(operator);
    expect(renewed.status).toBe(200);

    await updateOperator(admin, id, { password: 'Otra-clave-segura-2026' });
    expect((await refresh({ ...operator, cookie: refreshCookie(renewed) })).status).toBe(401);
  });
});
