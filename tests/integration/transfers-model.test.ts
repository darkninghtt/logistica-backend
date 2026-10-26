import type { Pool } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { MOVEMENT_TYPES } from '../../src/domain/stock';
import { createTestPool, truncateAll } from '../helpers/db';

const pool: Pool = createTestPool();

let userId: string;
let originId: string;
let destinationId: string;
let productId: string;

async function insertId(sql: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(sql);
  const row = rows[0];
  if (!row) throw new Error('El INSERT no devolvió el id');
  return row.id;
}

async function insertTransfer(origin = originId, destination = destinationId): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO transfers (origin_warehouse_id, destination_warehouse_id, created_by)
     VALUES ($1, $2, $3) RETURNING id`,
    [origin, destination, userId],
  );
  const row = rows[0];
  if (!row) throw new Error('El INSERT no devolvió el id');
  return row.id;
}

function insertMovement(type: string): Promise<unknown> {
  return pool.query(
    `INSERT INTO stock_movements
       (product_id, warehouse_id, type, quantity, unit_cost, balance_qty, balance_avg_cost, created_by)
     VALUES ($1, $2, $3, 1, 10, 1, 10, $4)`,
    [productId, originId, type, userId],
  );
}

beforeEach(async () => {
  await truncateAll(pool);
  userId = await insertId(
    `INSERT INTO users (email, password_hash, name, role)
     VALUES ('t@example.com', 'h', 'T', 'ADMIN') RETURNING id`,
  );
  originId = await insertId(
    `INSERT INTO warehouses (code, name) VALUES ('BOD-A', 'A') RETURNING id`,
  );
  destinationId = await insertId(
    `INSERT INTO warehouses (code, name) VALUES ('BOD-B', 'B') RETURNING id`,
  );
  productId = await insertId(
    `INSERT INTO products (sku, name, unit) VALUES ('SKU-1', 'P', 'u') RETURNING id`,
  );
});

afterAll(async () => {
  await truncateAll(pool);
  await pool.end();
});

describe('esquema de traspasos', () => {
  it('un traspaso nace en DRAFT', async () => {
    const id = await insertTransfer();
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM transfers WHERE id = $1',
      [id],
    );
    expect(rows[0]?.status).toBe('DRAFT');
  });

  it('rechaza origen igual al destino', async () => {
    await expect(insertTransfer(originId, originId)).rejects.toThrow(
      /transfers_warehouses_differ_check/,
    );
  });

  it('rechaza un estado desconocido', async () => {
    const id = await insertTransfer();
    await expect(
      pool.query(`UPDATE transfers SET status = 'LOST' WHERE id = $1`, [id]),
    ).rejects.toThrow(/transfers_status_check/);
  });

  it('los ítems exigen cantidad enviada > 0 y no repiten producto', async () => {
    const id = await insertTransfer();
    await expect(
      pool.query(
        'INSERT INTO transfer_items (transfer_id, product_id, quantity_sent) VALUES ($1, $2, 0)',
        [id, productId],
      ),
    ).rejects.toThrow(/transfer_items_quantity_sent_check/);

    await pool.query(
      'INSERT INTO transfer_items (transfer_id, product_id, quantity_sent) VALUES ($1, $2, 5)',
      [id, productId],
    );
    await expect(
      pool.query(
        'INSERT INTO transfer_items (transfer_id, product_id, quantity_sent) VALUES ($1, $2, 1)',
        [id, productId],
      ),
    ).rejects.toThrow(/transfer_items_pkey/);
  });
});

describe('transfer_events es inmutable', () => {
  it('admite INSERT pero rechaza UPDATE y DELETE', async () => {
    const id = await insertTransfer();
    await pool.query(
      `INSERT INTO transfer_events (transfer_id, from_status, to_status, actor_id)
       VALUES ($1, NULL, 'DRAFT', $2)`,
      [id, userId],
    );
    await expect(pool.query(`UPDATE transfer_events SET reason = 'x'`)).rejects.toThrow(
      /inmutable/,
    );
    await expect(pool.query('DELETE FROM transfer_events')).rejects.toThrow(/inmutable/);
  });
});

describe('stock_movements con los tipos nuevos', () => {
  it.each(MOVEMENT_TYPES)('acepta el tipo %s', async (type) => {
    await expect(insertMovement(type)).resolves.toBeDefined();
  });

  it('rechaza un tipo desconocido', async () => {
    await expect(insertMovement('REFUND')).rejects.toThrow(/stock_movements_type_check/);
  });

  it('guarda el motivo y el traspaso, y sigue siendo inmutable', async () => {
    const transferId = await insertTransfer();
    await pool.query(
      `INSERT INTO stock_movements
         (product_id, warehouse_id, type, quantity, unit_cost, balance_qty, balance_avg_cost,
          created_by, reason, transfer_id)
       VALUES ($1, $2, 'TRANSFER_OUT', 1, 10, 0, 10, $3, 'prueba', $4)`,
      [productId, originId, userId, transferId],
    );
    const { rows } = await pool.query<{ reason: string; transfer_id: string }>(
      'SELECT reason, transfer_id FROM stock_movements',
    );
    expect(rows[0]).toEqual({ reason: 'prueba', transfer_id: transferId });
    await expect(pool.query(`UPDATE stock_movements SET reason = 'x'`)).rejects.toThrow(
      /inmutable/,
    );
  });
});
