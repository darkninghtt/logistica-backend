import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../src/domain/authorization';
import { ForbiddenError, NotFoundError } from '../../src/domain/errors';
import { encodeCursor } from '../../src/domain/page';
import { toKardexRow } from '../../src/domain/reports';
import type { MovementType, StockMovement } from '../../src/domain/stock';
import { createReportsService, type ReportsStore } from '../../src/services/reports';
import { createWarehouseAccess } from '../../src/services/warehouse-access';
import { allowAllAccess } from '../helpers/actors';

const WAREHOUSE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const TRANSFER = '44444444-4444-4444-8444-444444444444';

function movement(type: MovementType, overrides: Partial<StockMovement> = {}): StockMovement {
  return {
    id: '7',
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    type,
    quantity: 3,
    unitCost: '90.0000',
    balanceQty: 17,
    balanceAvgCost: '104.1176',
    reason: null,
    transferId: null,
    createdBy: 'u-1',
    createdAt: '2026-11-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('toKardexRow', () => {
  it.each(['ENTRY', 'TRANSFER_IN', 'ADJUSTMENT_IN'] as const)('%s es una entrada', (type) => {
    expect(toKardexRow(movement(type))).toMatchObject({ quantityIn: 3, quantityOut: 0 });
  });

  it.each(['TRANSFER_OUT', 'SHRINKAGE'] as const)('%s es una salida', (type) => {
    expect(toKardexRow(movement(type))).toMatchObject({ quantityIn: 0, quantityOut: 3 });
  });

  it('la merma en tránsito no es entrada ni salida, pero conserva su cantidad', () => {
    expect(toKardexRow(movement('TRANSIT_SHRINKAGE'))).toMatchObject({
      quantity: 3,
      quantityIn: 0,
      quantityOut: 0,
    });
  });

  it('valoriza el saldo con el CPP resultante y 4 decimales exactos (17 × 104.1176)', () => {
    expect(toKardexRow(movement('TRANSFER_IN')).balanceValue).toBe('1769.9992');
  });

  it('la referencia es el motivo y, si no hay, el traspaso', () => {
    expect(toKardexRow(movement('SHRINKAGE', { reason: 'DAMAGE: caja rota' })).reference).toBe(
      'DAMAGE: caja rota',
    );
    expect(toKardexRow(movement('TRANSFER_OUT', { transferId: TRANSFER })).reference).toBe(
      TRANSFER,
    );
    expect(
      toKardexRow(movement('TRANSIT_SHRINKAGE', { transferId: TRANSFER, reason: 'Se cayó' })),
    ).toMatchObject({ reference: 'Se cayó', transferId: TRANSFER });
    expect(toKardexRow(movement('ENTRY')).reference).toBeNull();
  });
});

describe('ReportsService.kardex', () => {
  const query = { warehouseId: WAREHOUSE, productId: PRODUCT, limit: 2 };
  const ADMIN: Actor = { userId: 'u-admin', role: 'ADMIN' };

  function fakeStore(rows: StockMovement[] = [], overrides: Partial<ReportsStore> = {}) {
    const store: ReportsStore = {
      findWarehouse: vi.fn(async () => ({ id: WAREHOUSE, code: 'A', name: 'Bodega A' })),
      findProduct: vi.fn(async () => ({ id: PRODUCT, sku: 'SKU-1', name: 'Tornillo', unit: 'un' })),
      listKardex: vi.fn(async () => rows),
      ...overrides,
    };
    return store;
  }

  it('pide una fila de más y devuelve la página con la bodega, el producto y el cursor', async () => {
    const store = fakeStore([
      movement('ENTRY', { id: '1' }),
      movement('ENTRY', { id: '2' }),
      movement('ENTRY', { id: '3' }),
    ]);
    const page = await createReportsService({ store, access: allowAllAccess }).kardex(query, ADMIN);

    expect(store.listKardex).toHaveBeenCalledWith(WAREHOUSE, PRODUCT, 3, undefined);
    expect(page.data.map((r) => r.id)).toEqual(['1', '2']);
    expect(page.nextCursor).toBe(encodeCursor('2'));
    expect(page.warehouse).toMatchObject({ code: 'A' });
    expect(page.product).toMatchObject({ sku: 'SKU-1' });
  });

  it('pasa el cursor decodificado y en la última página nextCursor es null', async () => {
    const store = fakeStore([movement('ENTRY', { id: '3' })]);
    const page = await createReportsService({ store, access: allowAllAccess }).kardex(
      { ...query, cursor: '2' },
      ADMIN,
    );

    expect(store.listKardex).toHaveBeenCalledWith(WAREHOUSE, PRODUCT, 3, '2');
    expect(page.nextCursor).toBeNull();
  });

  it('el OPERATOR recibe 403 sin que se consulte nada', async () => {
    const store = fakeStore();
    const service = createReportsService({ store, access: allowAllAccess });

    await expect(service.kardex(query, { userId: 'u-op', role: 'OPERATOR' })).rejects.toThrow(
      ForbiddenError,
    );
    expect(store.findWarehouse).not.toHaveBeenCalled();
    expect(store.listKardex).not.toHaveBeenCalled();
  });

  it('el jefe de otra bodega recibe 403 aunque el middleware lo haya dejado pasar', async () => {
    const store = fakeStore();
    const service = createReportsService({
      store,
      access: createWarehouseAccess({ assignments: { warehouseIdsOf: async () => [OTHER] } }),
    });

    await expect(
      service.kardex(query, { userId: 'u-jefe', role: 'WAREHOUSE_MANAGER' }),
    ).rejects.toThrow(ForbiddenError);
    expect(store.listKardex).not.toHaveBeenCalled();
  });

  it('una bodega o un producto inexistentes dan 404', async () => {
    const noWarehouse = fakeStore([], { findWarehouse: vi.fn(async () => null) });
    const noProduct = fakeStore([], { findProduct: vi.fn(async () => null) });

    await expect(
      createReportsService({ store: noWarehouse, access: allowAllAccess }).kardex(query, ADMIN),
    ).rejects.toThrow(new NotFoundError('La bodega no existe'));
    await expect(
      createReportsService({ store: noProduct, access: allowAllAccess }).kardex(query, ADMIN),
    ).rejects.toThrow(new NotFoundError('El producto no existe'));
  });
});
