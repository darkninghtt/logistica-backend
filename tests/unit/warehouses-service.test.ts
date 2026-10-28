import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/domain/errors';
import type { Warehouse } from '../../src/domain/warehouse';
import { createWarehousesService, type WarehouseStore } from '../../src/services/warehouses';
import { ADMIN_ACTOR, allowAllAccess } from '../helpers/actors';

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
    listActive: vi.fn(async () => [
      { id: warehouse.id, code: warehouse.code, name: warehouse.name },
    ]),
    insert: vi.fn(async () => warehouse),
    update: vi.fn(async () => warehouse),
    ...overrides,
  };
}

describe('WarehousesService', () => {
  it('list calcula el desplazamiento a partir de la página y devuelve el formato de lista', async () => {
    const store = fakeStore();
    const result = await createWarehousesService({
      warehouses: store,
      access: allowAllAccess,
    }).list({ page: 3, pageSize: 20 }, ADMIN_ACTOR);

    expect(store.list).toHaveBeenCalledWith(20, 40, null);
    expect(result).toEqual({ data: [warehouse], page: 3, pageSize: 20, total: 41 });
  });

  it('listDestinations devuelve las bodegas activas del almacén, sin paginar ni filtrar por actor', async () => {
    const store = fakeStore();
    const result = await createWarehousesService({
      warehouses: store,
      access: allowAllAccess,
    }).listDestinations();

    expect(store.listActive).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ data: [{ id: warehouse.id, code: 'A', name: 'Bodega A' }] });
  });

  it('create delega en el almacén y devuelve la bodega creada', async () => {
    const store = fakeStore();
    const input = { code: 'A', name: 'Bodega A', active: true };

    expect(
      await createWarehousesService({ warehouses: store, access: allowAllAccess }).create(
        input,
        ADMIN_ACTOR,
      ),
    ).toEqual(warehouse);
    expect(store.insert).toHaveBeenCalledWith(input);
  });

  it('update devuelve la bodega editada', async () => {
    const store = fakeStore();
    const input = { code: 'A', name: 'Nuevo nombre', active: false };

    await createWarehousesService({ warehouses: store, access: allowAllAccess }).update(
      'w-1',
      input,
      ADMIN_ACTOR,
    );
    expect(store.update).toHaveBeenCalledWith('w-1', input);
  });

  it('update lanza NotFoundError si la bodega no existe', async () => {
    const store = fakeStore({ update: vi.fn(async () => null) });
    const service = createWarehousesService({ warehouses: store, access: allowAllAccess });

    await expect(
      service.update('no-existe', { code: 'A', name: 'A', active: true }, ADMIN_ACTOR),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
