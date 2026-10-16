import type { PoolClient } from 'pg';
import { NotFoundError } from '../domain/errors';
import { totalValue, type StockLevel, type StockMovement } from '../domain/stock';
import type { StockStore } from '../services/stock';

interface LevelRow {
  product_id: string;
  warehouse_id: string;
  quantity: number;
  avg_cost: string;
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
}

const FOREIGN_KEY_VIOLATION = '23503';

function toLevel(row: LevelRow): StockLevel {
  const balance = { quantity: row.quantity, avgCost: row.avg_cost };
  return {
    productId: row.product_id,
    warehouseId: row.warehouse_id,
    ...balance,
    totalValue: totalValue(balance),
  };
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
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
  };
}

/** Traduce la violación de clave foránea a un 404 que dice qué recurso falta. */
function missingReference(err: unknown): NotFoundError | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  if (err.code !== FOREIGN_KEY_VIOLATION) return null;
  const constraint = 'constraint' in err ? err.constraint : undefined;
  if (constraint === 'stock_levels_product_id_fkey') {
    return new NotFoundError('El producto no existe');
  }
  if (constraint === 'stock_levels_warehouse_id_fkey') {
    return new NotFoundError('La bodega no existe');
  }
  return null;
}

/** Solo SQL. Recibe el cliente de la transacción: todo lo que haga queda dentro de ella. */
export function createStockRepository(client: PoolClient): StockStore {
  return {
    async ensureLevel(productId, warehouseId) {
      try {
        await client.query(
          `INSERT INTO stock_levels (product_id, warehouse_id) VALUES ($1, $2)
           ON CONFLICT (product_id, warehouse_id) DO NOTHING`,
          [productId, warehouseId],
        );
      } catch (err) {
        throw missingReference(err) ?? err;
      }
    },

    async lockLevel(productId, warehouseId) {
      const { rows } = await client.query<LevelRow>(
        `SELECT product_id, warehouse_id, quantity, avg_cost FROM stock_levels
         WHERE product_id = $1 AND warehouse_id = $2 FOR UPDATE`,
        [productId, warehouseId],
      );
      const row = rows[0];
      if (!row) {
        throw new Error('El nivel de stock debería existir tras ensureLevel');
      }
      return { quantity: row.quantity, avgCost: row.avg_cost };
    },

    async saveLevel(productId, warehouseId, balance) {
      const { rows } = await client.query<LevelRow>(
        `UPDATE stock_levels
         SET quantity = $3, avg_cost = $4, version = version + 1, updated_at = now()
         WHERE product_id = $1 AND warehouse_id = $2
         RETURNING product_id, warehouse_id, quantity, avg_cost`,
        [productId, warehouseId, balance.quantity, balance.avgCost],
      );
      const row = rows[0];
      if (!row) {
        throw new Error('No se pudo actualizar el nivel de stock bloqueado');
      }
      return toLevel(row);
    },

    async insertMovement(m) {
      const { rows } = await client.query<MovementRow>(
        `INSERT INTO stock_movements
           (product_id, warehouse_id, type, quantity, unit_cost, balance_qty, balance_avg_cost, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, product_id, warehouse_id, type, quantity, unit_cost, balance_qty,
                   balance_avg_cost, created_by, created_at`,
        [
          m.productId,
          m.warehouseId,
          m.type,
          m.quantity,
          m.unitCost,
          m.balanceQty,
          m.balanceAvgCost,
          m.createdBy,
        ],
      );
      const row = rows[0];
      if (!row) {
        throw new Error('El INSERT no devolvió el movimiento creado');
      }
      return toMovement(row);
    },
  };
}
