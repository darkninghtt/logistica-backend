import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import type { StockLevel, StockMovement } from '../../src/domain/stock';
import { stockEntryBodySchema } from '../../src/schemas/stock';
import { parseWith } from '../../src/schemas/parse';
import { createStockService, type StockStore } from '../../src/services/stock';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function fakeStore(current = { quantity: 10, avgCost: '100.0000' }): {
  store: StockStore;
  calls: string[];
} {
  const calls: string[] = [];
  const store: StockStore = {
    ensureLevel: vi.fn(async () => {
      calls.push('ensureLevel');
    }),
    lockLevel: vi.fn(async () => {
      calls.push('lockLevel');
      return current;
    }),
    saveLevel: vi.fn(async (productId, warehouseId, balance): Promise<StockLevel> => {
      calls.push('saveLevel');
      return { productId, warehouseId, ...balance, totalValue: '0.0000' };
    }),
    insertMovement: vi.fn(async (m): Promise<StockMovement> => {
      calls.push('insertMovement');
      return { ...m, id: '1', createdAt: '2026-01-01T00:00:00.000Z' };
    }),
  };
  return { store, calls };
}

describe('StockService.registerEntry', () => {
  it('bloquea el nivel, calcula el CPP y guarda nivel y movimiento, en ese orden', async () => {
    const { store, calls } = fakeStore();
    const service = createStockService({ runInTransaction: (work) => work(store) });

    const result = await service.registerEntry(
      { productId: PRODUCT, warehouseId: WAREHOUSE, quantity: 10, unitCost: '120' },
      USER,
    );

    expect(calls).toEqual(['ensureLevel', 'lockLevel', 'saveLevel', 'insertMovement']);
    expect(result.stockLevel).toMatchObject({ quantity: 20, avgCost: '110.0000' });
    expect(result.movement).toMatchObject({
      type: 'ENTRY',
      quantity: 10,
      unitCost: '120',
      balanceQty: 20,
      balanceAvgCost: '110.0000',
      createdBy: USER,
    });
  });

  it('si la regla de dominio falla, no guarda nada', async () => {
    const { store, calls } = fakeStore({ quantity: 1_000_000_000, avgCost: '1.0000' });
    const service = createStockService({ runInTransaction: (work) => work(store) });

    await expect(
      service.registerEntry(
        { productId: PRODUCT, warehouseId: WAREHOUSE, quantity: 1, unitCost: '1' },
        USER,
      ),
    ).rejects.toThrow(ValidationError);
    expect(calls).toEqual(['ensureLevel', 'lockLevel']);
  });

  it('propaga el error de la transacción (el rollback lo hace runInTransaction)', async () => {
    const { store } = fakeStore();
    store.insertMovement = vi.fn(async () => {
      throw new Error('fallo simulado');
    });
    const service = createStockService({ runInTransaction: (work) => work(store) });

    await expect(
      service.registerEntry(
        { productId: PRODUCT, warehouseId: WAREHOUSE, quantity: 1, unitCost: '1' },
        USER,
      ),
    ).rejects.toThrow('fallo simulado');
  });
});

describe('stockEntryBodySchema', () => {
  const valid = { warehouseId: WAREHOUSE, productId: PRODUCT, quantity: 10, unitCost: '100.50' };

  it('acepta un cuerpo válido', () => {
    expect(parseWith(stockEntryBodySchema, valid)).toEqual(valid);
  });

  it.each([
    ['cantidad 0', { quantity: 0 }],
    ['cantidad negativa', { quantity: -3 }],
    ['cantidad decimal', { quantity: 1.5 }],
    ['cantidad como texto', { quantity: '10' }],
    ['costo como número', { unitCost: 100 }],
    ['costo 0', { unitCost: '0' }],
    ['costo negativo', { unitCost: '-5' }],
    ['costo con 5 decimales', { unitCost: '1.12345' }],
    ['costo no numérico', { unitCost: 'barato' }],
    ['bodega que no es uuid', { warehouseId: 'abc' }],
    ['producto que no es uuid', { productId: 'abc' }],
  ])('rechaza %s', (_name, patch) => {
    expect(() => parseWith(stockEntryBodySchema, { ...valid, ...patch })).toThrow(ValidationError);
  });

  it('rechaza un cuerpo sin campos', () => {
    expect(() => parseWith(stockEntryBodySchema, {})).toThrow(ValidationError);
  });
});
