import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { encodeCursor } from '../../src/domain/page';
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

describe('cursor de stockMovementsQuerySchema', () => {
  it('sin cursor es la primera página y el límite por defecto es 20', () => {
    expect(parseWith(stockMovementsQuerySchema, { warehouseId: ID })).toEqual({
      warehouseId: ID,
      limit: 20,
    });
  });

  it('decodifica un cursor válido al id del movimiento', () => {
    const query = parseWith(stockMovementsQuerySchema, {
      warehouseId: ID,
      cursor: encodeCursor('1234'),
      limit: '5',
    });
    expect(query).toMatchObject({ cursor: '1234', limit: 5 });
  });

  it.each([
    ['texto que no es base64url', '%%%'],
    ['base64url de algo que no es un id', encodeCursor('abc')],
    ['un id cero', encodeCursor('0')],
    ['un id negativo', encodeCursor('-5')],
    ['un id con ceros a la izquierda', encodeCursor('007')],
    ['un id que no cabe en BIGINT', encodeCursor('9'.repeat(19))],
    ['un cursor con caracteres de más', `${encodeCursor('12')}==`],
    ['un cursor vacío', ''],
  ])('rechaza %s', (_caso, cursor) => {
    expect(() => parseWith(stockMovementsQuerySchema, { warehouseId: ID, cursor })).toThrow(
      ValidationError,
    );
  });

  it.each(['0', '101', '2.5'])('rechaza limit=%s', (limit) => {
    expect(() => parseWith(stockMovementsQuerySchema, { warehouseId: ID, limit })).toThrow(
      ValidationError,
    );
  });

  it('acepta un tipo de movimiento conocido y rechaza uno inventado', () => {
    expect(parseWith(stockMovementsQuerySchema, { warehouseId: ID, type: 'SHRINKAGE' }).type).toBe(
      'SHRINKAGE',
    );
    expect(() => parseWith(stockMovementsQuerySchema, { warehouseId: ID, type: 'GIFT' })).toThrow(
      ValidationError,
    );
  });
});
