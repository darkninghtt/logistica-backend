import { NotFoundError } from '../domain/errors';
import { toCursorPage, type CursorPage, type Page } from '../domain/page';
import type { MovementType } from '../domain/stock';
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

/** Filtros del historial de movimientos. */
export interface MovementFilter {
  warehouseId: string;
  productId?: string;
  type?: MovementType;
}

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
  /**
   * Hasta `limit` movimientos, del más nuevo al más antiguo, con id menor que `beforeId` si viene.
   * Al paginar por id, los movimientos que se insertan mientras se recorre no corren las páginas.
   */
  listMovements(
    filter: MovementFilter,
    limit: number,
    beforeId: string | undefined,
  ): Promise<StockMovementItem[]>;
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
  ): Promise<CursorPage<StockMovementItem | StockMovementItemNoCost>>;
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

    async listMovements({ warehouseId, productId, type, limit, cursor }, actor) {
      await access.assert(actor, warehouseId);
      await requireWarehouse(warehouseId);
      if (productId && !(await store.productExists(productId))) {
        throw new NotFoundError('El producto no existe');
      }
      // Se pide una fila de más para saber si hay otra página
      const rows = await store.listMovements({ warehouseId, productId, type }, limit + 1, cursor);
      const page = toCursorPage(rows, limit);
      return actor.role === ROLE_WITHOUT_COSTS
        ? { data: page.data.map(withoutMovementCosts), nextCursor: page.nextCursor }
        : page;
    },
  };
}
