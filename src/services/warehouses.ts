import { NotFoundError } from '../domain/errors';
import type { Page, Warehouse } from '../domain/warehouse';
import type { PageQuery, WarehouseInput } from '../schemas/warehouses';

/** Lo que el servicio necesita de la persistencia (la implementa el repositorio). */
export interface WarehouseStore {
  /** Una página de bodegas ordenadas por código, y el total de bodegas. */
  list(limit: number, offset: number): Promise<{ rows: Warehouse[]; total: number }>;
  insert(input: WarehouseInput): Promise<Warehouse>;
  /** Reemplaza code, name y active. Devuelve null si el id no existe. */
  update(id: string, input: WarehouseInput): Promise<Warehouse | null>;
}

export interface WarehousesService {
  list(query: PageQuery): Promise<Page<Warehouse>>;
  create(input: WarehouseInput): Promise<Warehouse>;
  update(id: string, input: WarehouseInput): Promise<Warehouse>;
}

export function createWarehousesService({
  warehouses,
}: {
  warehouses: WarehouseStore;
}): WarehousesService {
  return {
    async list({ page, pageSize }) {
      const { rows, total } = await warehouses.list(pageSize, (page - 1) * pageSize);
      return { data: rows, page, pageSize, total };
    },

    create(input) {
      return warehouses.insert(input);
    },

    async update(id, input) {
      const updated = await warehouses.update(id, input);
      if (!updated) {
        throw new NotFoundError('La bodega no existe');
      }
      return updated;
    },
  };
}
