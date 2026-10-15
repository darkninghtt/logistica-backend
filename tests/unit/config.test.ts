import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config';

describe('loadConfig', () => {
  it('usa valores por defecto cuando no hay variables', () => {
    expect(loadConfig({})).toEqual({ NODE_ENV: 'development', PORT: 3000, LOG_LEVEL: 'info' });
  });

  it('convierte PORT a número', () => {
    expect(loadConfig({ PORT: '4100' }).PORT).toBe(4100);
  });

  it('rechaza un PORT inválido con un mensaje legible', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/Variables de entorno inválidas: PORT/);
  });

  it('rechaza un NODE_ENV desconocido', () => {
    expect(() => loadConfig({ NODE_ENV: 'staging' })).toThrow(/NODE_ENV/);
  });
});
