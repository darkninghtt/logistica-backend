import { assertRole, type Actor } from '../domain/authorization';
import { NotFoundError } from '../domain/errors';
import { toCursorPage, type CursorPage } from '../domain/page';
import {
  REPORT_ROLES,
  toKardexRow,
  type KardexRow,
  type ReportProduct,
  type ReportWarehouse,
} from '../domain/reports';
import type { StockMovement } from '../domain/stock';
import type { KardexQuery } from '../schemas/reports';
import type { WarehouseAccess } from './warehouse-access';

/** Lo que el servicio necesita de la persistencia (solo lectura; la implementa el repositorio). */
export interface ReportsStore {
  findWarehouse(id: string): Promise<ReportWarehouse | null>;
  findProduct(id: string): Promise<ReportProduct | null>;
  /**
   * Hasta `limit` movimientos de un producto en una bodega, en orden cronológico (del más antiguo
   * al más nuevo), con id mayor que `afterId` si viene.
   */
  listKardex(
    warehouseId: string,
    productId: string,
    limit: number,
    afterId: string | undefined,
  ): Promise<StockMovement[]>;
}

export interface KardexPage extends CursorPage<KardexRow> {
  warehouse: ReportWarehouse;
  product: ReportProduct;
}

export interface ReportsService {
  kardex(query: KardexQuery, actor: Actor): Promise<KardexPage>;
}

export interface ReportsDeps {
  store: ReportsStore;
  access: WarehouseAccess;
}

export function createReportsService({ store, access }: ReportsDeps): ReportsService {
  return {
    async kardex({ warehouseId, productId, limit, cursor }, actor) {
      // Primero el permiso: sin alcance global, una bodega ajena o inexistente da 403 (no 404)
      assertRole(actor, REPORT_ROLES);
      await access.assert(actor, warehouseId);
      const [warehouse, product] = await Promise.all([
        store.findWarehouse(warehouseId),
        store.findProduct(productId),
      ]);
      if (!warehouse) throw new NotFoundError('La bodega no existe');
      if (!product) throw new NotFoundError('El producto no existe');

      // Se pide una fila de más para saber si hay otra página
      const rows = await store.listKardex(warehouseId, productId, limit + 1, cursor);
      return { ...toCursorPage(rows.map(toKardexRow), limit), warehouse, product };
    },
  };
}
