import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { parseWith } from '../../src/schemas/parse';
import { idParamSchema, pageQuerySchema, warehouseBodySchema } from '../../src/schemas/warehouses';

describe('warehouseBodySchema', () => {
  it('recorta espacios y activa la bodega por defecto', () => {
    expect(parseWith(warehouseBodySchema, { code: ' A ', name: ' Bodega A ' })).toEqual({
      code: 'A',
      name: 'Bodega A',
      active: true,
    });
  });

  it.each([
    ['sin código', { name: 'Bodega' }],
    ['código vacío', { code: '   ', name: 'Bodega' }],
    ['sin nombre', { code: 'A' }],
    ['código demasiado largo', { code: 'A'.repeat(21), name: 'Bodega' }],
    ['active no booleano', { code: 'A', name: 'Bodega', active: 'si' }],
  ])('rechaza %s', (_caso, body) => {
    expect(() => parseWith(warehouseBodySchema, body)).toThrow(ValidationError);
  });
});

describe('pageQuerySchema', () => {
  it('usa página 1 y 20 por página por defecto', () => {
    expect(parseWith(pageQuerySchema, {})).toEqual({ page: 1, pageSize: 20 });
  });

  it('convierte el texto de la query a números', () => {
    expect(parseWith(pageQuerySchema, { page: '2', pageSize: '5' })).toEqual({
      page: 2,
      pageSize: 5,
    });
  });

  it.each([{ page: '0' }, { page: 'x' }, { pageSize: '0' }, { pageSize: '101' }])(
    'rechaza %o',
    (query) => {
      expect(() => parseWith(pageQuerySchema, query)).toThrow(ValidationError);
    },
  );
});

describe('idParamSchema', () => {
  it('rechaza un id que no es UUID', () => {
    expect(() => parseWith(idParamSchema, { id: '123' })).toThrow(ValidationError);
  });
});
