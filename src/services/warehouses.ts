import { assertRole, type Actor } from '../domain/authorization';
import { NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import type { Warehouse } from '../domain/warehouse';
import type { PageQuery } from '../schemas/page';
import type { WarehouseInput } from '../schemas/warehouses';
import type { WarehouseAccess } from './warehouse-access';

/** Lo que el servicio necesita de la persistencia (la implementa el repositorio). */
export interface WarehouseStore {
  /**
   * Una página de bodegas ordenadas por código, y el total. Con `onlyIds` solo cuenta esas
   * bodegas; `null` significa todas.
   */
  list(
    limit: number,
    offset: number,
    onlyIds: string[] | null,
  ): Promise<{ rows: Warehouse[]; total: number }>;
  insert(input: WarehouseInput): Promise<Warehouse>;
  /** Reemplaza code, name y active. Devuelve null si el id no existe. */
  update(id: string, input: WarehouseInput): Promise<Warehouse | null>;
}

export interface WarehousesService {
  /** ADMIN y AUDITOR ven todas; el jefe de bodega y el operario, solo las asignadas. */
  list(query: PageQuery, actor: Actor): Promise<Page<Warehouse>>;
  /** Solo el ADMIN. */
  create(input: WarehouseInput, actor: Actor): Promise<Warehouse>;
  /** Solo el ADMIN. */
  update(id: string, input: WarehouseInput, actor: Actor): Promise<Warehouse>;
}

export function createWarehousesService({
  warehouses,
  access,
}: {
  warehouses: WarehouseStore;
  access: WarehouseAccess;
}): WarehousesService {
  return {
    async list({ page, pageSize }, actor) {
      const onlyIds = await access.visibleIds(actor);
      const { rows, total } = await warehouses.list(pageSize, (page - 1) * pageSize, onlyIds);
      return { data: rows, page, pageSize, total };
    },

    async create(input, actor) {
      assertRole(actor, ['ADMIN']);
      return warehouses.insert(input);
    },

    async update(id, input, actor) {
      assertRole(actor, ['ADMIN']);
      const updated = await warehouses.update(id, input);
      if (!updated) {
        throw new NotFoundError('La bodega no existe');
      }
      return updated;
    },
  };
}
