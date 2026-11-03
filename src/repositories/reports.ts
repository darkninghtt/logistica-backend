import type { Pool, PoolClient } from 'pg';
import type { ReportProduct, ReportWarehouse } from '../domain/reports';
import type { MovementType, StockMovement } from '../domain/stock';
import type { ReportsStore } from '../services/reports';

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
  };
}
