import type { Pool, PoolClient } from 'pg';
import { totalValue } from '../domain/stock';
import type { StockLevelItem, StockMovementItem } from '../domain/stock-queries';
import type { StockQueryStore } from '../services/stock-queries';

interface LevelRow {
  product_id: string;
  warehouse_id: string;
  quantity: number;
  avg_cost: string;
  sku: string;
  name: string;
  unit: string;
}

interface MovementRow {
  id: string;
  product_id: string;
  warehouse_id: string;
  type: 'ENTRY';
  quantity: number;
  unit_cost: string;
  balance_qty: number;
  balance_avg_cost: string;
  created_by: string;
  created_at: Date;
  sku: string;
  name: string;
}

function toLevelItem(row: LevelRow): StockLevelItem {
  const balance = { quantity: row.quantity, avgCost: row.avg_cost };
  return {
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    ...balance,
    totalValue: totalValue(balance),
    productSku: row.sku,
    productName: row.name,
    productUnit: row.unit,
  };
}

function toMovementItem(row: MovementRow): StockMovementItem {
  return {
    id: row.id,
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    type: row.type,
    quantity: row.quantity,
    unitCost: row.unit_cost,
    balanceQty: row.balance_qty,
    balanceAvgCost: row.balance_avg_cost,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    productSku: row.sku,
    productName: row.name,
  };
}

/** Solo SQL de lectura. Recibe el pool o el cliente de una transacción. */
export function createStockQueryRepository(db: Pool | PoolClient): StockQueryStore {
  return {
    async warehouseExists(warehouseId) {
      const { rowCount } = await db.query('SELECT 1 FROM warehouses WHERE id = $1', [warehouseId]);
      return rowCount === 1;
    },

    async productExists(productId) {
      const { rowCount } = await db.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      return rowCount === 1;
    },

    async listLevels(warehouseId, limit, offset) {
      const { rows } = await db.query<LevelRow>(
        `SELECT l.product_id, l.warehouse_id, l.quantity, l.avg_cost, p.sku, p.name, p.unit
         FROM stock_levels l
         JOIN products p ON p.id = l.product_id
         WHERE l.warehouse_id = $1
         ORDER BY lower(p.sku)
         LIMIT $2 OFFSET $3`,
        [warehouseId, limit, offset],
      );
      const count = await db.query<{ total: string }>(
        'SELECT count(*) AS total FROM stock_levels WHERE warehouse_id = $1',
        [warehouseId],
      );
      return { rows: rows.map(toLevelItem), total: Number(count.rows[0]?.total ?? 0) };
    },

    async listMovements(warehouseId, productId, limit, offset) {
      // `$2::uuid IS NULL` deja el filtro por producto como opcional con una sola consulta
      const { rows } = await db.query<MovementRow>(
        `SELECT m.id, m.product_id, m.warehouse_id, m.type, m.quantity, m.unit_cost,
                m.balance_qty, m.balance_avg_cost, m.created_by, m.created_at, p.sku, p.name
         FROM stock_movements m
         JOIN products p ON p.id = m.product_id
         WHERE m.warehouse_id = $1 AND ($2::uuid IS NULL OR m.product_id = $2::uuid)
         ORDER BY m.id DESC
         LIMIT $3 OFFSET $4`,
        [warehouseId, productId ?? null, limit, offset],
      );
      const count = await db.query<{ total: string }>(
        `SELECT count(*) AS total FROM stock_movements
         WHERE warehouse_id = $1 AND ($2::uuid IS NULL OR product_id = $2::uuid)`,
        [warehouseId, productId ?? null],
      );
      return { rows: rows.map(toMovementItem), total: Number(count.rows[0]?.total ?? 0) };
    },
  };
}
