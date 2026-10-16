import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { parseWith } from '../../src/schemas/parse';
import { stockLevelsQuerySchema, stockMovementsQuerySchema } from '../../src/schemas/stock-queries';

const ID = '0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11';

describe('stockLevelsQuerySchema', () => {
  it('exige la bodega y aplica la paginación por defecto', () => {
    expect(parseWith(stockLevelsQuerySchema, { warehouseId: ID })).toEqual({
      warehouseId: ID,
      page: 1,
      pageSize: 20,
    });
  });

  it.each([{}, { warehouseId: '123' }, { warehouseId: ID, page: '0' }])('rechaza %o', (query) => {
    expect(() => parseWith(stockLevelsQuerySchema, query)).toThrow(ValidationError);
  });
});

describe('stockMovementsQuerySchema', () => {
  it('el producto es opcional', () => {
    expect(parseWith(stockMovementsQuerySchema, { warehouseId: ID }).productId).toBeUndefined();
    expect(parseWith(stockMovementsQuerySchema, { warehouseId: ID, productId: ID }).productId).toBe(
      ID,
    );
  });

  it('rechaza un productId que no es UUID', () => {
    expect(() =>
      parseWith(stockMovementsQuerySchema, { warehouseId: ID, productId: 'abc' }),
    ).toThrow(ValidationError);
  });
});
