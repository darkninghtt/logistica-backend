import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

const URL = 'postgresql://u:p@localhost:5432/db';

describe('loadConfig', () => {
  it('usa valores por defecto cuando no hay variables', () => {
    expect(loadConfig({ DATABASE_URL: URL })).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      LOG_LEVEL: 'info',
      DATABASE_URL: URL,
    });
  });

  it('convierte PORT a número', () => {
    expect(loadConfig({ PORT: '4100', DATABASE_URL: URL }).PORT).toBe(4100);
  });

  it('rechaza un PORT inválido con un mensaje legible', () => {
    expect(() => loadConfig({ PORT: 'abc', DATABASE_URL: URL })).toThrow(
      /Variables de entorno inválidas: PORT/,
    );
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging', DATABASE_URL: URL })).toThrow(/NODE_ENV/);
  });

  it('exige DATABASE_URL', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });
});
