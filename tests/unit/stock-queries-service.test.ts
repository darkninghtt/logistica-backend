import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/domain/errors';
import type { StockLevelItem, StockMovementItem } from '../../src/domain/stock-queries';
import { createStockQueryService, type StockQueryStore } from '../../src/services/stock-queries';
import { ADMIN_ACTOR, allowAllAccess } from '../helpers/actors';

const WAREHOUSE = '0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11';
const PRODUCT = '7c1d2e3f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

const level: StockLevelItem = {
  productId: PRODUCT,
  warehouseId: WAREHOUSE,
  quantity: 20,
  avgCost: '110.0000',
  totalValue: '2200.0000',
  productSku: 'SKU-1',
  productName: 'Tornillo',
  productUnit: 'un',
};

const movement: StockMovementItem = {
  id: '2',
  productId: PRODUCT,
  warehouseId: WAREHOUSE,
  type: 'ENTRY',
  quantity: 10,
  unitCost: '120.0000',
  balanceQty: 20,
  balanceAvgCost: '110.0000',
  reason: null,
  transferId: null,
  createdBy: 'u-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  productSku: 'SKU-1',
  productName: 'Tornillo',
};

function fakeStore(overrides: Partial<StockQueryStore> = {}): StockQueryStore {
  return {
    warehouseExists: vi.fn(async () => true),
    productExists: vi.fn(async () => true),
    listLevels: vi.fn(async () => ({ rows: [level], total: 41 })),
    listMovements: vi.fn(async () => ({ rows: [movement], total: 41 })),
    ...overrides,
  };
}

describe('StockQueryService.listLevels', () => {
  it('calcula el desplazamiento y devuelve el formato de lista', async () => {
    const store = fakeStore();
    const result = await createStockQueryService({ store, access: allowAllAccess }).listLevels(
      { warehouseId: WAREHOUSE, page: 3, pageSize: 20 },
      ADMIN_ACTOR,
    );

    expect(store.listLevels).toHaveBeenCalledWith(WAREHOUSE, 20, 40);
    expect(result).toEqual({ data: [level], page: 3, pageSize: 20, total: 41 });
  });

  it('lanza NotFoundError si la bodega no existe y no consulta los niveles', async () => {
    const store = fakeStore({ warehouseExists: vi.fn(async () => false) });
    const service = createStockQueryService({ store, access: allowAllAccess });

    await expect(
      service.listLevels({ warehouseId: WAREHOUSE, page: 1, pageSize: 20 }, ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.listLevels).not.toHaveBeenCalled();
  });
});

describe('StockQueryService.listMovements', () => {
  it('sin producto no filtra y calcula el desplazamiento', async () => {
    const store = fakeStore();
    const result = await createStockQueryService({ store, access: allowAllAccess }).listMovements(
      { warehouseId: WAREHOUSE, page: 2, pageSize: 10 },
      ADMIN_ACTOR,
    );

    expect(store.productExists).not.toHaveBeenCalled();
    expect(store.listMovements).toHaveBeenCalledWith(WAREHOUSE, undefined, 10, 10);
    expect(result).toEqual({ data: [movement], page: 2, pageSize: 10, total: 41 });
  });

  it('con producto lo valida y lo pasa como filtro', async () => {
    const store = fakeStore();
    await createStockQueryService({ store, access: allowAllAccess }).listMovements(
      { warehouseId: WAREHOUSE, productId: PRODUCT, page: 1, pageSize: 20 },
      ADMIN_ACTOR,
    );

    expect(store.productExists).toHaveBeenCalledWith(PRODUCT);
    expect(store.listMovements).toHaveBeenCalledWith(WAREHOUSE, PRODUCT, 20, 0);
  });

  it('lanza NotFoundError si la bodega no existe', async () => {
    const store = fakeStore({ warehouseExists: vi.fn(async () => false) });
    const service = createStockQueryService({ store, access: allowAllAccess });

    await expect(
      service.listMovements({ warehouseId: WAREHOUSE, page: 1, pageSize: 20 }, ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lanza NotFoundError si el producto no existe', async () => {
    const store = fakeStore({ productExists: vi.fn(async () => false) });
    const service = createStockQueryService({ store, access: allowAllAccess });

    await expect(
      service.listMovements(
        { warehouseId: WAREHOUSE, productId: PRODUCT, page: 1, pageSize: 20 },
        ADMIN_ACTOR,
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.listMovements).not.toHaveBeenCalled();
  });
});
