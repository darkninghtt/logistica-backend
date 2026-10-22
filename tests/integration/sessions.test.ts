import type { Pool } from 'pg';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { hashRefreshToken } from '../../src/services/sessions';
import { ADMIN, buildTestApp, seedTestAdmin } from '../helpers/app';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();
const base = buildTestApp(pool);
const app = createApp({ ...base.deps, cookieSecure: true });

beforeEach(async () => {
  await truncateAll(pool);
  await seedTestAdmin(pool);
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

function setCookies(res: request.Response): string[] {
  const header = res.headers['set-cookie'];
  return Array.isArray(header) ? header : [];
}

/** Valor de la cookie `refresh_token` que devolvió el servidor. */
function refreshCookie(res: request.Response): string {
  const cookie = setCookies(res).find((c) => c.startsWith('refresh_token='));
  const value = cookie?.split(';')[0]?.slice('refresh_token='.length);
  if (!value) throw new Error('La respuesta no trae la cookie refresh_token');
  return value;
}

async function login(): Promise<request.Response> {
  return request(app)
    .post('/api/auth/login')
    .send({ email: ADMIN.email, password: ADMIN.password });
}

function refreshWith(token: string): request.Test {
  return request(app).post('/api/auth/refresh').set('Cookie', `refresh_token=${token}`);
}

describe('POST /api/auth/login: cookie del refresh', () => {
  it('fija la cookie con HttpOnly, SameSite=Strict, Secure y Path=/api/auth', async () => {
    const res = await login();
    expect(res.status).toBe(200);
    const cookie = setCookies(res).find((c) => c.startsWith('refresh_token='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\/api\/auth/i);
    expect(cookie).toMatch(/Expires=/i);
  });

  it('el refresh token nunca va en el cuerpo de la respuesta', async () => {
    const res = await login();
    expect(Object.keys(res.body).sort()).toEqual(['accessToken', 'user']);
    expect(res.text).not.toContain(refreshCookie(res));
  });

  it('sin cookieSecure la cookie no lleva Secure (desarrollo local)', async () => {
    const res = await request(base.app)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password });
    const cookie = setCookies(res).find((c) => c.startsWith('refresh_token='));
    expect(cookie).not.toMatch(/Secure/i);
  });

  it('en la BD solo queda el hash del token, nunca su valor', async () => {
    const token = refreshCookie(await login());
    const { rows } = await pool.query<{ token_hash: string }>(
      'SELECT token_hash FROM refresh_tokens',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.token_hash).toBe(hashRefreshToken(token));
    expect(rows[0]?.token_hash).not.toBe(token);
  });
});

describe('POST /api/auth/refresh', () => {
  it('con un refresh válido devuelve un access token que funciona y rota la cookie', async () => {
    const first = refreshCookie(await login());
    const res = await refreshWith(first);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: ADMIN.email, role: 'ADMIN' });
    expect(refreshCookie(res)).not.toBe(first);
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${res.body.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('reutilizar un refresh ya rotado da 401 y revoca la familia (el más nuevo deja de servir)', async () => {
    const first = refreshCookie(await login());
    const second = refreshCookie(await refreshWith(first));

    const reused = await refreshWith(first);
    expect(reused.status).toBe(401);
    expect(reused.body.code).toBe('UNAUTHORIZED');

    const newest = await refreshWith(second);
    expect(newest.status).toBe(401);
  });

  it('sin cookie da 401', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  it('con un token inexistente da 401', async () => {
    const res = await refreshWith('token-que-no-existe');
    expect(res.status).toBe(401);
  });

  it('con un refresh vencido da 401', async () => {
    const token = refreshCookie(await login());
    await pool.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'");
    const res = await refreshWith(token);
    expect(res.status).toBe(401);
  });

  it('un usuario desactivado no renueva ni inicia sesión', async () => {
    const token = refreshCookie(await login());
    await pool.query('UPDATE users SET active = false');

    expect((await refreshWith(token)).status).toBe(401);
    expect((await login()).status).toBe(401);
  });

  it('dos refresh simultáneos con el mismo token no producen dos sesiones válidas', async () => {
    const token = refreshCookie(await login());
    const results = await Promise.all(Array.from({ length: 5 }, () => refreshWith(token)));

    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 401)).toHaveLength(4);
    const { rows } = await pool.query<{ valid: string }>(
      'SELECT count(*) AS valid FROM refresh_tokens WHERE used_at IS NULL AND revoked_at IS NULL',
    );
    expect(Number(rows[0]?.valid)).toBeLessThanOrEqual(1);
  });
});

describe('POST /api/auth/logout', () => {
  it('responde 204, borra la cookie y el refresh deja de servir', async () => {
    const token = refreshCookie(await login());
    const res = await request(app).post('/api/auth/logout').set('Cookie', `refresh_token=${token}`);

    expect(res.status).toBe(204);
    const cleared = setCookies(res).find((c) => c.startsWith('refresh_token='));
    expect(cleared).toMatch(/refresh_token=;/);
    expect(cleared).toMatch(/Path=\/api\/auth/i);
    expect((await refreshWith(token)).status).toBe(401);
  });

  it('sin cookie igual responde 204', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(204);
  });
});

describe('rate limiting', () => {
  const limits = {
    general: { limit: 1000, windowMs: 60_000 },
    auth: { limit: 3, windowMs: 60_000 },
    refresh: { limit: 3, windowMs: 60_000 },
  };

  it('superar los intentos fallidos de login da 429 con el formato de error uniforme', async () => {
    const limited = createApp({ ...base.deps, rateLimits: limits });
    const attempt = () =>
      request(limited)
        .post('/api/auth/login')
        .set('x-correlation-id', 'rl-1')
        .send({ email: ADMIN.email, password: 'incorrecta' });

    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const res = await attempt();
    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Demasiadas peticiones, intenta de nuevo más tarde',
      correlationId: 'rl-1',
    });
  });

  it('el refresh también tiene el límite estricto cuando llega con una cookie inválida', async () => {
    const limited = createApp({ ...base.deps, rateLimits: limits });
    const attempt = () =>
      request(limited).post('/api/auth/refresh').set('Cookie', 'refresh_token=inventado');
    for (let i = 0; i < 3; i++) {
      expect((await attempt()).status).toBe(401);
    }
    expect((await attempt()).status).toBe(429);
  });

  it('un refresh sin cookie no gasta el límite (abrir la página sin sesión no bloquea)', async () => {
    const limited = createApp({ ...base.deps, rateLimits: limits });
    for (let i = 0; i < 6; i++) {
      expect((await request(limited).post('/api/auth/refresh')).status).toBe(401);
    }
    const login = await request(limited)
      .post('/api/auth/login')
      .send({ email: ADMIN.email, password: ADMIN.password });
    const token = login.headers['set-cookie']?.[0]?.split(';')[0]?.slice('refresh_token='.length);
    const res = await request(limited)
      .post('/api/auth/refresh')
      .set('Cookie', `refresh_token=${token}`);
    expect(res.status).toBe(200);
  });

  it('los fallos de login no gastan el límite del refresh', async () => {
    const limited = createApp({ ...base.deps, rateLimits: limits });
    for (let i = 0; i < 3; i++) {
      await request(limited)
        .post('/api/auth/login')
        .send({ email: ADMIN.email, password: 'incorrecta' });
    }
    const res = await request(limited)
      .post('/api/auth/refresh')
      .set('Cookie', 'refresh_token=inventado');
    expect(res.status).toBe(401);
  });

  it('los inicios de sesión correctos no gastan el límite estricto', async () => {
    const limited = createApp({ ...base.deps, rateLimits: limits });
    for (let i = 0; i < 6; i++) {
      const res = await request(limited)
        .post('/api/auth/login')
        .send({ email: ADMIN.email, password: ADMIN.password });
      expect(res.status).toBe(200);
    }
  });

  it('el límite general cuenta todas las peticiones a /api', async () => {
    const limited = createApp({
      ...base.deps,
      rateLimits: {
        general: { limit: 3, windowMs: 60_000 },
        auth: limits.auth,
        refresh: limits.refresh,
      },
    });
    for (let i = 0; i < 3; i++) {
      expect((await request(limited).get('/api/warehouses')).status).toBe(401);
    }
    const res = await request(limited).get('/api/warehouses');
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('TOO_MANY_REQUESTS');
  });

  it('no limita /health', async () => {
    const limited = createApp({
      ...base.deps,
      rateLimits: {
        general: { limit: 1, windowMs: 60_000 },
        auth: limits.auth,
        refresh: limits.refresh,
      },
    });
    for (let i = 0; i < 4; i++) {
      expect((await request(limited).get('/health')).status).toBe(200);
    }
  });
});
