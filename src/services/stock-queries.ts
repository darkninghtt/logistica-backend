import { NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import type { Actor } from '../domain/authorization';
import {
  withoutLevelCosts,
  withoutMovementCosts,
  type StockLevelItem,
  type StockLevelItemNoCost,
  type StockMovementItem,
  type StockMovementItemNoCost,
} from '../domain/stock-queries';
import type { StockLevelsQuery, StockMovementsQuery } from '../schemas/stock-queries';
import type { WarehouseAccess } from './warehouse-access';

/** Lo que el servicio necesita de la persistencia (solo lectura; la implementa el repositorio). */
export interface StockQueryStore {
  warehouseExists(warehouseId: string): Promise<boolean>;
  productExists(productId: string): Promise<boolean>;
  /** Niveles de una bodega ordenados por SKU, y el total de niveles. */
  listLevels(
    warehouseId: string,
    limit: number,
    offset: number,
  ): Promise<{ rows: StockLevelItem[]; total: number }>;
  /** Movimientos de una bodega (opcionalmente de un producto), del más nuevo al más antiguo. */
  listMovements(
    warehouseId: string,
    productId: string | undefined,
    limit: number,
    offset: number,
  ): Promise<{ rows: StockMovementItem[]; total: number }>;
}

/** Los costos son datos sensibles: el OPERATOR no los recibe (se quitan aquí, no en la interfaz). */
const ROLE_WITHOUT_COSTS = 'OPERATOR';

export interface StockQueryService {
  listLevels(
    query: StockLevelsQuery,
    actor: Actor,
  ): Promise<Page<StockLevelItem | StockLevelItemNoCost>>;
  listMovements(
    query: StockMovementsQuery,
    actor: Actor,
  ): Promise<Page<StockMovementItem | StockMovementItemNoCost>>;
}

export function createStockQueryService({
  store,
  access,
}: {
  store: StockQueryStore;
  access: WarehouseAccess;
}): StockQueryService {
  async function requireWarehouse(warehouseId: string): Promise<void> {
    if (!(await store.warehouseExists(warehouseId))) {
      throw new NotFoundError('La bodega no existe');
    }
  }

  return {
    async listLevels({ warehouseId, page, pageSize }, actor) {
      await access.assert(actor, warehouseId);
      await requireWarehouse(warehouseId);
      const { rows, total } = await store.listLevels(warehouseId, pageSize, (page - 1) * pageSize);
      const data = actor.role === ROLE_WITHOUT_COSTS ? rows.map(withoutLevelCosts) : rows;
      return { data, page, pageSize, total };
    },

    async listMovements({ warehouseId, productId, page, pageSize }, actor) {
      await access.assert(actor, warehouseId);
      await requireWarehouse(warehouseId);
      if (productId && !(await store.productExists(productId))) {
        throw new NotFoundError('El producto no existe');
      }
      const { rows, total } = await store.listMovements(
        warehouseId,
        productId,
        pageSize,
        (page - 1) * pageSize,
      );
      const data = actor.role === ROLE_WITHOUT_COSTS ? rows.map(withoutMovementCosts) : rows;
      return { data, page, pageSize, total };
    },
  };
}
