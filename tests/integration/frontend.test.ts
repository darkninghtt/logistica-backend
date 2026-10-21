import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app';
import { buildTestApp } from '../helpers/app';
import { createTestPool } from '../helpers/db';

const pool = createTestPool();
let publicDir: string;
let app: Express;

beforeAll(() => {
  publicDir = mkdtempSync(path.join(os.tmpdir(), 'logistica-public-'));
  writeFileSync(path.join(publicDir, 'index.html'), '<html><body>FRONT</body></html>');
  mkdirSync(path.join(publicDir, 'assets'));
  writeFileSync(path.join(publicDir, 'assets', 'app.js'), 'console.log(1)');
  // Misma composición que main.ts, más la carpeta del frontend
  const base = buildTestApp(pool);
  app = createApp({ ...base.deps, publicDir });
});

afterAll(async () => {
  rmSync(publicDir, { recursive: true, force: true });
  await pool.end();
});

describe('frontend servido por el backend', () => {
  it('la raíz devuelve el index.html', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('FRONT');
  });

  it('sirve los archivos estáticos', async () => {
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.text).toBe('console.log(1)');
  });

  it('una ruta del router de Vue devuelve el index.html (recargar no da 404)', async () => {
    const res = await request(app).get('/stock/movimientos');
    expect(res.status).toBe(200);
    expect(res.text).toContain('FRONT');
  });

  it('no tapa /health', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('no tapa /api-docs', async () => {
    const res = await request(app).get('/api-docs.json');
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBeDefined();
  });

  it('una ruta de /api sin token sigue dando 401 JSON, no el index.html', async () => {
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(res.text).not.toContain('FRONT');
  });

  it('un POST a una ruta del front no recibe el index.html', async () => {
    const res = await request(app).post('/stock/movimientos');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('sin index.html en la carpeta no se sirve el frontend', async () => {
    const empty = mkdtempSync(path.join(os.tmpdir(), 'logistica-empty-'));
    try {
      const base = buildTestApp(pool);
      const sinFront = createApp({ ...base.deps, publicDir: empty });
      const res = await request(sinFront).get('/stock');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
