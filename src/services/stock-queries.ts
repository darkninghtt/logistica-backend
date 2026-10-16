import { NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import type { StockLevelItem, StockMovementItem } from '../domain/stock-queries';
import type { StockLevelsQuery, StockMovementsQuery } from '../schemas/stock-queries';

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

export interface StockQueryService {
  listLevels(query: StockLevelsQuery): Promise<Page<StockLevelItem>>;
  listMovements(query: StockMovementsQuery): Promise<Page<StockMovementItem>>;
}

export function createStockQueryService({ store }: { store: StockQueryStore }): StockQueryService {
  async function requireWarehouse(warehouseId: string): Promise<void> {
    if (!(await store.warehouseExists(warehouseId))) {
      throw new NotFoundError('La bodega no existe');
    }
  }

  return {
    async listLevels({ warehouseId, page, pageSize }) {
      await requireWarehouse(warehouseId);
      const { rows, total } = await store.listLevels(warehouseId, pageSize, (page - 1) * pageSize);
      return { data: rows, page, pageSize, total };
    },

    async listMovements({ warehouseId, productId, page, pageSize }) {
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
      return { data: rows, page, pageSize, total };
    },
  };
}
