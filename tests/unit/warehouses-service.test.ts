import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/domain/errors';
import type { Warehouse } from '../../src/domain/warehouse';
import { createWarehousesService, type WarehouseStore } from '../../src/services/warehouses';

const warehouse: Warehouse = {
  id: 'w-1',
  code: 'A',
  name: 'Bodega A',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fakeStore(overrides: Partial<WarehouseStore> = {}): WarehouseStore {
  return {
    list: vi.fn(async () => ({ rows: [warehouse], total: 41 })),
    insert: vi.fn(async () => warehouse),
    update: vi.fn(async () => warehouse),
    ...overrides,
  };
}

describe('WarehousesService', () => {
  it('list calcula el desplazamiento a partir de la página y devuelve el formato de lista', async () => {
    const store = fakeStore();
    const result = await createWarehousesService({ warehouses: store }).list({
      page: 3,
      pageSize: 20,
    });

    expect(store.list).toHaveBeenCalledWith(20, 40);
    expect(result).toEqual({ data: [warehouse], page: 3, pageSize: 20, total: 41 });
  });

  it('create delega en el almacén y devuelve la bodega creada', async () => {
    const store = fakeStore();
    const input = { code: 'A', name: 'Bodega A', active: true };

    expect(await createWarehousesService({ warehouses: store }).create(input)).toEqual(warehouse);
    expect(store.insert).toHaveBeenCalledWith(input);
  });

  it('update devuelve la bodega editada', async () => {
    const store = fakeStore();
    const input = { code: 'A', name: 'Nuevo nombre', active: false };

    await createWarehousesService({ warehouses: store }).update('w-1', input);
    expect(store.update).toHaveBeenCalledWith('w-1', input);
  });

  it('update lanza NotFoundError si la bodega no existe', async () => {
    const store = fakeStore({ update: vi.fn(async () => null) });
    const service = createWarehousesService({ warehouses: store });

    await expect(
      service.update('no-existe', { code: 'A', name: 'A', active: true }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
