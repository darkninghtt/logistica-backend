import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../helpers/app';
import { createTestPool } from '../helpers/db';

const pool = createTestPool();
const { app } = buildTestApp(pool);

afterAll(async () => {
  await pool.end();
});

/** Directivas de la CSP como mapa: `script-src` → `'self'`. */
function csp(res: request.Response): Record<string, string> {
  const header = String(res.headers['content-security-policy'] ?? '');
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name = '', ...values] = part.split(/\s+/);
        return [name, values.join(' ')];
      }),
  );
}

describe('cabeceras de seguridad (helmet)', () => {
  it('las respuestas de la API llevan las cabeceras estándar', async () => {
    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=/);
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('la CSP de la aplicación solo permite scripts y conexiones del mismo origen', async () => {
    const policy = csp(await request(app).get('/health'));

    expect(policy['default-src']).toBe("'self'");
    expect(policy['script-src']).toBe("'self'");
    expect(policy['connect-src']).toBe("'self'");
    expect(policy['object-src']).toBe("'none'");
    expect(policy['frame-ancestors']).toBe("'none'");
    expect(policy['script-src']).not.toContain('unsafe-inline');
    expect(policy).not.toHaveProperty('upgrade-insecure-requests');
  });

  it('también van en los errores (401 sin token)', async () => {
    const res = await request(app).get('/api/warehouses');
    expect(res.status).toBe(401);
    expect(csp(res)['script-src']).toBe("'self'");
  });

  it('Swagger UI tiene su propia CSP, que sigue sin permitir scripts en línea', async () => {
    const res = await request(app).get('/api-docs/');
    const policy = csp(res);

    expect(res.status).toBe(200);
    expect(policy['img-src']).toContain('https:');
    expect(policy['script-src']).toBe("'self'");
    // Swagger UI carga sus scripts como archivos del mismo origen, no en línea
    expect(res.text).not.toMatch(/<script>(?!\s*<\/script>)/);
  });
});
