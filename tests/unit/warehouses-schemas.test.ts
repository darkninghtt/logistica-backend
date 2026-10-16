import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { parseWith } from '../../src/schemas/parse';
import { warehouseBodySchema } from '../../src/schemas/warehouses';

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
