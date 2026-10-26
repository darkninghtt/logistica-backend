import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { parseWith } from '../../src/schemas/parse';
import {
  createTransferBodySchema,
  listTransfersQuerySchema,
  receiveTransferBodySchema,
  resolveTransferBodySchema,
  shrinkageBodySchema,
} from '../../src/schemas/transfers';

const A = '0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11';
const B = '1c1a2a6f-5a5f-4d4b-8b66-1e7a4e1a7b22';
const P1 = '2d2b3b7a-6b6a-4e5c-9c77-2f8b5f2b8c33';
const P2 = '3e3c4c8b-7c7b-4f6d-8d88-3a9c6a3c9d44';

const validCreate = {
  originWarehouseId: A,
  destinationWarehouseId: B,
  items: [{ productId: P1, quantity: 3 }],
};

describe('createTransferBodySchema', () => {
  it('acepta un traspaso válido y recorta la nota', () => {
    expect(parseWith(createTransferBodySchema, { ...validCreate, note: ' urgente ' }).note).toBe(
      'urgente',
    );
  });

  it.each([
    ['origen igual al destino', { ...validCreate, destinationWarehouseId: A }],
    ['sin ítems', { ...validCreate, items: [] }],
    [
      'producto repetido',
      {
        ...validCreate,
        items: [
          { productId: P1, quantity: 1 },
          { productId: P1, quantity: 2 },
        ],
      },
    ],
    ['cantidad 0', { ...validCreate, items: [{ productId: P1, quantity: 0 }] }],
    ['cantidad decimal', { ...validCreate, items: [{ productId: P1, quantity: 1.5 }] }],
    ['bodega que no es UUID', { ...validCreate, originWarehouseId: '123' }],
  ])('rechaza: %s', (_caso, body) => {
    expect(() => parseWith(createTransferBodySchema, body)).toThrow(ValidationError);
  });
});

describe('listTransfersQuerySchema', () => {
  it('aplica la paginación por defecto y acepta los filtros', () => {
    expect(parseWith(listTransfersQuerySchema, {})).toEqual({ page: 1, pageSize: 20 });
    expect(
      parseWith(listTransfersQuerySchema, { status: 'IN_TRANSIT', warehouseId: A }),
    ).toMatchObject({ status: 'IN_TRANSIT', warehouseId: A });
  });

  it('rechaza un estado desconocido', () => {
    expect(() => parseWith(listTransfersQuerySchema, { status: 'LOST' })).toThrow(ValidationError);
  });
});

describe('receiveTransferBodySchema', () => {
  it('acepta cantidad recibida cero y varios productos distintos', () => {
    expect(
      parseWith(receiveTransferBodySchema, {
        items: [
          { productId: P1, receivedQuantity: 0 },
          { productId: P2, receivedQuantity: 2 },
        ],
      }).items,
    ).toHaveLength(2);
  });

  it.each([
    ['sin ítems', { items: [] }],
    ['cantidad negativa', { items: [{ productId: P1, receivedQuantity: -1 }] }],
    [
      'producto repetido',
      {
        items: [
          { productId: P1, receivedQuantity: 1 },
          { productId: P1, receivedQuantity: 1 },
        ],
      },
    ],
  ])('rechaza: %s', (_caso, body) => {
    expect(() => parseWith(receiveTransferBodySchema, body)).toThrow(ValidationError);
  });
});

describe('resolveTransferBodySchema', () => {
  it('exige el motivo', () => {
    expect(parseWith(resolveTransferBodySchema, { reason: 'Se perdió en la ruta' }).reason).toBe(
      'Se perdió en la ruta',
    );
    expect(() => parseWith(resolveTransferBodySchema, {})).toThrow(ValidationError);
    expect(() => parseWith(resolveTransferBodySchema, { reason: '   ' })).toThrow(ValidationError);
  });
});

describe('shrinkageBodySchema', () => {
  const valid = { warehouseId: A, productId: P1, quantity: 2, reason: 'DAMAGE' };

  it('acepta los cuatro motivos', () => {
    for (const reason of ['DAMAGE', 'EXPIRED', 'THEFT', 'COUNT_ADJUSTMENT']) {
      expect(parseWith(shrinkageBodySchema, { ...valid, reason }).reason).toBe(reason);
    }
  });

  it.each([
    ['motivo inválido', { ...valid, reason: 'LOST' }],
    ['cantidad 0', { ...valid, quantity: 0 }],
    ['sin bodega', { ...valid, warehouseId: undefined }],
  ])('rechaza: %s', (_caso, body) => {
    expect(() => parseWith(shrinkageBodySchema, body)).toThrow(ValidationError);
  });
});
