import type { Pool } from 'pg';
import { expect } from 'vitest';

/** Cuánto suma (+) o resta (-) cada tipo de movimiento al stock de su bodega. */
const SIGN: Record<string, 1 | 0 | -1> = {
  ENTRY: 1,
  TRANSFER_IN: 1,
  ADJUSTMENT_IN: 1,
  TRANSFER_OUT: -1,
  SHRINKAGE: -1,
  // La merma en tránsito no mueve el stock de ninguna bodega: la fila guarda el saldo sin cambios
  TRANSIT_SHRINKAGE: 0,
};

/**
 * El libro cuadra con stock_levels: repitiendo los movimientos en orden, el saldo que guarda cada
 * fila es el anterior más o menos su cantidad, y el resultado final es el stock actual. Además
 * ningún nivel es negativo.
 */
export async function expectLedgerMatchesLevels(pool: Pool): Promise<void> {
  const { rows } = await pool.query<{
    product_id: string;
    warehouse_id: string;
    type: string;
    quantity: number;
    balance_qty: number;
  }>(
    'SELECT product_id, warehouse_id, type, quantity, balance_qty FROM stock_movements ORDER BY id',
  );
  const replayed = new Map<string, number>();
  for (const row of rows) {
    const key = `${row.product_id}|${row.warehouse_id}`;
    const sign = SIGN[row.type];
    if (sign === undefined) throw new Error(`Tipo de movimiento desconocido: ${row.type}`);
    const balance = (replayed.get(key) ?? 0) + sign * row.quantity;
    expect(row.balance_qty, `saldo tras ${row.type} #${key}`).toBe(balance);
    replayed.set(key, balance);
  }

  const levels = await pool.query<{ product_id: string; warehouse_id: string; quantity: number }>(
    'SELECT product_id, warehouse_id, quantity FROM stock_levels',
  );
  for (const row of levels.rows) {
    expect(row.quantity).toBeGreaterThanOrEqual(0);
    expect(row.quantity).toBe(replayed.get(`${row.product_id}|${row.warehouse_id}`) ?? 0);
  }
}

/** Ninguna transición se registró dos veces para el mismo traspaso. */
export async function expectNoDuplicateEvents(pool: Pool): Promise<void> {
  const { rows } = await pool.query(
    `SELECT transfer_id, to_status FROM transfer_events
     GROUP BY transfer_id, to_status HAVING count(*) > 1`,
  );
  expect(rows).toEqual([]);
}
