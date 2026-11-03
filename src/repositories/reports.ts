import type { Pool, PoolClient } from 'pg';
import type {
  ReportProduct,
  ReportWarehouse,
  ShrinkageReportRow,
  ShrinkageType,
} from '../domain/reports';
import type { MovementType, StockMovement } from '../domain/stock';
import type { InTransitRecord, ReportsStore } from '../services/reports';

interface MovementRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  type: MovementType;
  quantity: number;
  unit_cost: string;
  balance_qty: number;
  balance_avg_cost: string;
  reason: string | null;
  transfer_id: string | null;
  created_by: string;
  created_at: Date;
}

function toMovement(row: MovementRow): StockMovement {
  return {
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    type: row.type,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    balanceQty: row.balance_qty,
    balanceAvgCost: row.balance_avg_cost,
    reason: row.reason,
    transferId: row.transfer_id,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

interface ShrinkageRow {
  warehouse_id: string;
  warehouse_code: string;
  warehouse_name: string;
  product_id: string;
  sku: string;
  product_name: string;
  type: ShrinkageType;
  reason: string | null;
  quantity: number;
  value: string;
}

interface InTransitRow {
  id: string;
  origin_id: string;
  origin_code: string;
  origin_name: string;
  destination_id: string;
  destination_code: string;
  destination_name: string;
  dispatched_at: Date;
  quantity: number;
  value: string;
}

/** Solo SQL de lectura para los reportes. Recibe el pool o el cliente de una transacción. */
export function createReportsRepository(db: Pool | PoolClient): ReportsStore {
  return {
    async findWarehouse(id) {
      const { rows } = await db.query<ReportWarehouse>(
        'SELECT id, code, name FROM warehouses WHERE id = $1',
        [id],
      );
      return rows[0] ?? null;
    },

    async findProduct(id) {
      const { rows } = await db.query<ReportProduct>(
        'SELECT id, sku, name, unit FROM products WHERE id = $1',
        [id],
      );
      return rows[0] ?? null;
    },

    async listKardex(warehouseId, productId, limit, afterId) {
      // Keyset ascendente (`id > cursor`): usa el índice (warehouse_id, product_id, id)
      const { rows } = await db.query<MovementRow>(
        `SELECT id, product_id, warehouse_id, type, quantity, unit_cost, balance_qty,
                balance_avg_cost, reason, transfer_id, created_by, created_at
         FROM stock_movements
         WHERE warehouse_id = $1 AND product_id = $2
           AND ($3::bigint IS NULL OR id > $3::bigint)
         ORDER BY id
         LIMIT $4`,
        [warehouseId, productId, afterId ?? null, limit],
      );
      return rows.map(toMovement);
    },

    async listShrinkage({ warehouseIds, from, to, timeZone }): Promise<ShrinkageReportRow[]> {
      // De una merma de bodega se agrupa el código del motivo (lo que va antes de ": "); la merma
      // en tránsito no se agrupa por motivo. Las fechas se comparan en la zona horaria indicada.
      const { rows } = await db.query<ShrinkageRow>(
        `SELECT m.warehouse_id, w.code AS warehouse_code, w.name AS warehouse_name,
                m.product_id, p.sku, p.name AS product_name, m.type,
                CASE WHEN m.type = 'SHRINKAGE' THEN split_part(m.reason, ': ', 1) END AS reason,
                SUM(m.quantity)::int AS quantity,
                SUM(m.quantity * m.unit_cost)::numeric(20,4)::text AS value
         FROM stock_movements m
         JOIN warehouses w ON w.id = m.warehouse_id
         JOIN products p ON p.id = m.product_id
         WHERE m.type IN ('SHRINKAGE', 'TRANSIT_SHRINKAGE')
           AND ($1::uuid[] IS NULL OR m.warehouse_id = ANY($1::uuid[]))
           AND ($2::date IS NULL OR (m.created_at AT TIME ZONE $4::text)::date >= $2::date)
           AND ($3::date IS NULL OR (m.created_at AT TIME ZONE $4::text)::date <= $3::date)
         GROUP BY m.warehouse_id, w.code, w.name, m.product_id, p.sku, p.name, m.type,
                  CASE WHEN m.type = 'SHRINKAGE' THEN split_part(m.reason, ': ', 1) END
         ORDER BY lower(w.code), lower(p.sku), m.type, reason`,
        [warehouseIds, from ?? null, to ?? null, timeZone],
      );
      return rows.map((row) => ({
        warehouseId: row.warehouse_id,
        warehouseCode: row.warehouse_code,
        warehouseName: row.warehouse_name,
        productId: row.product_id,
        productSku: row.sku,
        productName: row.product_name,
        type: row.type,
        reason: row.reason,
        quantity: row.quantity,
        value: row.value,
      }));
    },

    async listInTransit(warehouseIds): Promise<InTransitRecord[]> {
      // Valor al costo congelado al despachar (unit_cost de cada ítem)
      const { rows } = await db.query<InTransitRow>(
        `SELECT t.id, t.origin_warehouse_id AS origin_id, o.code AS origin_code, o.name AS origin_name,
                t.destination_warehouse_id AS destination_id, d.code AS destination_code,
                d.name AS destination_name, t.dispatched_at,
                SUM(i.quantity_sent)::int AS quantity,
                SUM(i.quantity_sent * i.unit_cost)::numeric(20,4)::text AS value
         FROM transfers t
         JOIN warehouses o ON o.id = t.origin_warehouse_id
         JOIN warehouses d ON d.id = t.destination_warehouse_id
         JOIN transfer_items i ON i.transfer_id = t.id
         WHERE t.status = 'IN_TRANSIT'
           AND ($1::uuid[] IS NULL
                OR t.origin_warehouse_id = ANY($1::uuid[])
                OR t.destination_warehouse_id = ANY($1::uuid[]))
         GROUP BY t.id, o.code, o.name, d.code, d.name
         ORDER BY t.dispatched_at, t.id`,
        [warehouseIds],
      );
      return rows.map((row) => ({
        transferId: row.id,
        originWarehouseId: row.origin_id,
        originCode: row.origin_code,
        originName: row.origin_name,
        destinationWarehouseId: row.destination_id,
        destinationCode: row.destination_code,
        destinationName: row.destination_name,
        dispatchedAt: row.dispatched_at.toISOString(),
        quantity: row.quantity,
        value: row.value,
      }));
    },
  };
}
