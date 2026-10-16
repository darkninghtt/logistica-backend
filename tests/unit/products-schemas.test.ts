import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { parseWith } from '../../src/schemas/parse';
import { productBodySchema } from '../../src/schemas/products';

describe('productBodySchema', () => {
  it('recorta espacios', () => {
    expect(
      parseWith(productBodySchema, { sku: ' A-1 ', name: ' Tornillo ', unit: ' un ' }),
    ).toEqual({
      sku: 'A-1',
      name: 'Tornillo',
      unit: 'un',
    });
  });

  it.each([
    ['sin SKU', { name: 'Tornillo', unit: 'un' }],
    ['SKU vacío', { sku: '  ', name: 'Tornillo', unit: 'un' }],
    ['sin nombre', { sku: 'A', unit: 'un' }],
    ['sin unidad', { sku: 'A', name: 'Tornillo' }],
    ['SKU demasiado largo', { sku: 'A'.repeat(41), name: 'Tornillo', unit: 'un' }],
    ['unidad demasiado larga', { sku: 'A', name: 'Tornillo', unit: 'u'.repeat(21) }],
  ])('rechaza %s', (_caso, body) => {
    expect(() => parseWith(productBodySchema, body)).toThrow(ValidationError);
  });
});
