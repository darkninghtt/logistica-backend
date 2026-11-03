import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/domain/errors';
import { encodeCursor } from '../../src/domain/page';
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
    listMovements: vi.fn(async () => [movement]),
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
  const at = (id: string): StockMovementItem => ({ ...movement, id });

  it('primera página sin filtros: pide una fila de más y, si no llega, nextCursor es null', async () => {
    const store = fakeStore();
    const result = await createStockQueryService({ store, access: allowAllAccess }).listMovements(
      { warehouseId: WAREHOUSE, limit: 10 },
      ADMIN_ACTOR,
    );

    expect(store.productExists).not.toHaveBeenCalled();
    expect(store.listMovements).toHaveBeenCalledWith(
      { warehouseId: WAREHOUSE, productId: undefined, type: undefined },
      11,
      undefined,
    );
    expect(result).toEqual({ data: [movement], nextCursor: null });
  });

  it('si llega la fila de más, la descarta y el cursor apunta a la última entregada', async () => {
    const store = fakeStore({ listMovements: vi.fn(async () => [at('9'), at('8'), at('7')]) });
    const result = await createStockQueryService({ store, access: allowAllAccess }).listMovements(
      { warehouseId: WAREHOUSE, limit: 2 },
      ADMIN_ACTOR,
    );

    expect(result.data.map((m) => m.id)).toEqual(['9', '8']);
    expect(result.nextCursor).toBe(encodeCursor('8'));
  });

  it('pasa el cursor (ya decodificado), el producto y el tipo como filtros', async () => {
    const store = fakeStore();
    await createStockQueryService({ store, access: allowAllAccess }).listMovements(
      { warehouseId: WAREHOUSE, productId: PRODUCT, type: 'SHRINKAGE', limit: 20, cursor: '8' },
      ADMIN_ACTOR,
    );

    expect(store.productExists).toHaveBeenCalledWith(PRODUCT);
    expect(store.listMovements).toHaveBeenCalledWith(
      { warehouseId: WAREHOUSE, productId: PRODUCT, type: 'SHRINKAGE' },
      21,
      '8',
    );
  });

  it('el OPERATOR recibe la página sin costos y con el mismo cursor', async () => {
    const store = fakeStore({ listMovements: vi.fn(async () => [at('9'), at('8')]) });
    const result = await createStockQueryService({ store, access: allowAllAccess }).listMovements(
      { warehouseId: WAREHOUSE, limit: 1 },
      { userId: 'u-op', role: 'OPERATOR' },
    );

    expect(result.nextCursor).toBe(encodeCursor('9'));
    expect(result.data[0]).not.toHaveProperty('unitCost');
    expect(result.data[0]).not.toHaveProperty('balanceAvgCost');
  });

  it('lanza NotFoundError si la bodega no existe', async () => {
    const store = fakeStore({ warehouseExists: vi.fn(async () => false) });
    const service = createStockQueryService({ store, access: allowAllAccess });

    await expect(
      service.listMovements({ warehouseId: WAREHOUSE, limit: 20 }, ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('lanza NotFoundError si el producto no existe', async () => {
    const store = fakeStore({ productExists: vi.fn(async () => false) });
    const service = createStockQueryService({ store, access: allowAllAccess });

    await expect(
      service.listMovements({ warehouseId: WAREHOUSE, productId: PRODUCT, limit: 20 }, ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(store.listMovements).not.toHaveBeenCalled();
  });
});
