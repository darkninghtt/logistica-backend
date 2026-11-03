import { assertRole, type Actor } from '../domain/authorization';
import { NotFoundError } from '../domain/errors';
import { toCursorPage, type CursorPage } from '../domain/page';
import {
  REPORT_ROLES,
  REPORT_TIME_ZONE,
  daysInTransit,
  toKardexRow,
  type InTransitReport,
  type InTransitReportRow,
  type KardexRow,
  type ReportProduct,
  type ReportWarehouse,
  type ShrinkageReport,
  type ShrinkageReportRow,
} from '../domain/reports';
import { sumValues, type StockMovement } from '../domain/stock';
import type {
  InTransitQuery,
  KardexExportQuery,
  KardexQuery,
  ShrinkageExportQuery,
  ShrinkageReportQuery,
} from '../schemas/reports';
import { kardexCsv, kardexPdf, shrinkageCsv, shrinkagePdf, type ReportFile } from './report-files';
import type { WarehouseAccess } from './warehouse-access';

/** Filtro de mermas ya resuelto: `warehouseIds` null significa todas las bodegas. */
export interface ShrinkageFilter {
  warehouseIds: string[] | null;
  from?: string;
  to?: string;
  /** Zona horaria en la que se interpretan `from` y `to`. */
  timeZone: string;
}

/** Traspaso en tránsito tal como sale de la BD (los días se calculan en el servicio). */
export type InTransitRecord = Omit<InTransitReportRow, 'daysInTransit'>;

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
  /** Mermas agrupadas por bodega, producto, tipo y motivo (cantidad y valor ya sumados por grupo). */
  listShrinkage(filter: ShrinkageFilter): Promise<ShrinkageReportRow[]>;
  /** Traspasos IN_TRANSIT con origen o destino entre `warehouseIds` (null: todos). */
  listInTransit(warehouseIds: string[] | null): Promise<InTransitRecord[]>;
}

export interface KardexPage extends CursorPage<KardexRow> {
  warehouse: ReportWarehouse;
  product: ReportProduct;
}

export interface ReportsService {
  kardex(query: KardexQuery, actor: Actor): Promise<KardexPage>;
  exportKardex(query: KardexExportQuery, actor: Actor): Promise<ReportFile>;
  shrinkage(query: ShrinkageReportQuery, actor: Actor): Promise<ShrinkageReport>;
  exportShrinkage(query: ShrinkageExportQuery, actor: Actor): Promise<ReportFile>;
  inTransit(query: InTransitQuery, actor: Actor): Promise<InTransitReport>;
}

export interface ReportsDeps {
  store: ReportsStore;
  access: WarehouseAccess;
  /** Reloj (días en tránsito y fecha de generación); las pruebas lo fijan. */
  now?: () => Date;
}

/** Filas que se piden por vuelta al exportar el kardex completo. */
const EXPORT_BATCH = 500;

export function createReportsService({
  store,
  access,
  now = () => new Date(),
}: ReportsDeps): ReportsService {
  /**
   * Permiso y alcance: rol de reportes y, si se pide una bodega, que sea accesible (sin alcance
   * global, una bodega ajena o inexistente da 403). Sin bodega, las visibles (null: todas).
   */
  async function scope(actor: Actor, warehouseId: string | undefined): Promise<string[] | null> {
    assertRole(actor, REPORT_ROLES);
    if (warehouseId) {
      await access.assert(actor, warehouseId);
      return [warehouseId];
    }
    return access.visibleIds(actor);
  }

  async function kardexSubject(
    warehouseId: string,
    productId: string,
    actor: Actor,
  ): Promise<{ warehouse: ReportWarehouse; product: ReportProduct }> {
    await scope(actor, warehouseId);
    const [warehouse, product] = await Promise.all([
      store.findWarehouse(warehouseId),
      store.findProduct(productId),
    ]);
    if (!warehouse) throw new NotFoundError('La bodega no existe');
    if (!product) throw new NotFoundError('El producto no existe');
    return { warehouse, product };
  }

  async function shrinkage(query: ShrinkageReportQuery, actor: Actor): Promise<ShrinkageReport> {
    const warehouseIds = await scope(actor, query.warehouseId);
    const data = await store.listShrinkage({
      warehouseIds,
      from: query.from,
      to: query.to,
      timeZone: REPORT_TIME_ZONE,
    });
    return {
      data,
      totals: {
        quantity: data.reduce((sum, row) => sum + row.quantity, 0),
        value: sumValues(data.map((row) => row.value)),
      },
    };
  }

  return {
    async kardex({ warehouseId, productId, limit, cursor }, actor) {
      const subject = await kardexSubject(warehouseId, productId, actor);
      // Se pide una fila de más para saber si hay otra página
      const rows = await store.listKardex(warehouseId, productId, limit + 1, cursor);
      return { ...toCursorPage(rows.map(toKardexRow), limit), ...subject };
    },

    async exportKardex({ warehouseId, productId, format }, actor) {
      const subject = await kardexSubject(warehouseId, productId, actor);
      // Todo el kardex, por tandas con el mismo cursor que la API (sin OFFSET)
      const rows: KardexRow[] = [];
      let afterId: string | undefined;
      for (;;) {
        const batch = await store.listKardex(warehouseId, productId, EXPORT_BATCH, afterId);
        rows.push(...batch.map(toKardexRow));
        const last = batch.at(-1);
        if (batch.length < EXPORT_BATCH || !last) break;
        afterId = last.id;
      }
      const data = { ...subject, rows };
      return format === 'csv' ? kardexCsv(data) : kardexPdf(data, now());
    },

    shrinkage,

    async exportShrinkage({ format, ...filters }, actor) {
      const report = await shrinkage(filters, actor);
      const data = { report, from: filters.from, to: filters.to };
      return format === 'csv' ? shrinkageCsv(data) : shrinkagePdf(data, now());
    },

    async inTransit({ warehouseId }, actor) {
      const records = await store.listInTransit(await scope(actor, warehouseId));
      const current = now();
      const data = records.map((record) => ({
        ...record,
        daysInTransit: daysInTransit(record.dispatchedAt, current),
      }));
      return {
        data,
        totals: {
          transfers: data.length,
          quantity: data.reduce((sum, row) => sum + row.quantity, 0),
          value: sumValues(data.map((row) => row.value)),
        },
      };
    },
  };
}
