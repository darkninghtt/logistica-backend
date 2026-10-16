import type { Pool, PoolClient } from 'pg';
import { ConflictError } from '../domain/errors';
import type { Product } from '../domain/product';
import type { ProductStore } from '../services/products';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  unit: string;
  created_at: Date;
}

const COLUMNS = 'id, sku, name, unit, created_at';
const UNIQUE_VIOLATION = '23505';

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    unit: row.unit,
    createdAt: row.created_at.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

/** El índice único de la BD es quien decide (sin carreras): su error se traduce a un ConflictError. */
function duplicateSku(): ConflictError {
  return new ConflictError('Ya existe un producto con ese SKU');
}

/** Solo SQL. Recibe el pool o el cliente de una transacción. */
export function createProductsRepository(db: Pool | PoolClient): ProductStore {
  return {
    async list(limit, offset) {
      const { rows } = await db.query<ProductRow>(
        `SELECT ${COLUMNS} FROM products ORDER BY lower(sku) LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const count = await db.query<{ total: string }>('SELECT count(*) AS total FROM products');
      return { rows: rows.map(toProduct), total: Number(count.rows[0]?.total ?? 0) };
    },

    async insert(input) {
      try {
        const { rows } = await db.query<ProductRow>(
          `INSERT INTO products (sku, name, unit) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
          [input.sku, input.name, input.unit],
        );
        const row = rows[0];
        if (!row) {
          throw new Error('El INSERT no devolvió la fila creada');
        }
        return toProduct(row);
      } catch (err) {
        throw isUniqueViolation(err) ? duplicateSku() : err;
      }
    },

    async update(id, input) {
      try {
        const { rows } = await db.query<ProductRow>(
          `UPDATE products SET sku = $2, name = $3, unit = $4 WHERE id = $1
           RETURNING ${COLUMNS}`,
          [id, input.sku, input.name, input.unit],
        );
        const row = rows[0];
        return row ? toProduct(row) : null;
      } catch (err) {
        throw isUniqueViolation(err) ? duplicateSku() : err;
      }
    },
  };
}
