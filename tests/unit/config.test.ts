import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const URL = 'postgresql://u:p@localhost:5432/db';
const SECRET = 'un-secreto-de-prueba-de-al-menos-32-caracteres';
const BASE = { DATABASE_URL: URL, JWT_SECRET: SECRET };

describe('loadConfig', () => {
  it('usa valores por defecto cuando no hay variables', () => {
    expect(loadConfig({ ...BASE })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      TRUST_PROXY: 0,
      PUBLIC_DIR: 'public',
      LOG_LEVEL: 'info',
      DATABASE_URL: URL,
      JWT_SECRET: SECRET,
      JWT_ACCESS_TTL_SECONDS: 900,
    });
  });

  it('convierte PORT a número', () => {
    expect(loadConfig({ PORT: '4100', ...BASE }).PORT).toBe(4100);
  });

  it('rechaza un PORT inválido con un mensaje legible', () => {
    expect(() => loadConfig({ PORT: 'abc', ...BASE })).toThrow(
      /Variables de entorno inválidas: PORT/,
    );
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', ...BASE })).toThrow(/NODE_ENV/);
  });

  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({ JWT_SECRET: SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rechaza un JWT_SECRET corto', () => {
    expect(() => loadConfig({ DATABASE_URL: URL, JWT_SECRET: 'corto' })).toThrow(/JWT_SECRET/);
  });
});
