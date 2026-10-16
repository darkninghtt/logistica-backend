import type { Pool, PoolClient } from 'pg';
import { ConflictError } from '../domain/errors';
import type { Warehouse } from '../domain/warehouse';
import type { WarehouseStore } from '../services/warehouses';

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  active: boolean;
  created_at: Date;
}

const COLUMNS = 'id, code, name, active, created_at';
const UNIQUE_VIOLATION = '23505';

function toWarehouse(row: WarehouseRow): Warehouse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active,
    createdAt: row.created_at.toISOString(),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

/** El índice único de la BD es quien decide (sin carreras): su error se traduce a un ConflictError. */
function duplicateCode(): ConflictError {
  return new ConflictError('Ya existe una bodega con ese código');
}

/** Solo SQL. Recibe el pool o el cliente de una transacción. */
export function createWarehousesRepository(db: Pool | PoolClient): WarehouseStore {
  return {
    async list(limit, offset) {
      const { rows } = await db.query<WarehouseRow>(
        `SELECT ${COLUMNS} FROM warehouses ORDER BY lower(code) LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const count = await db.query<{ total: string }>('SELECT count(*) AS total FROM warehouses');
      return { rows: rows.map(toWarehouse), total: Number(count.rows[0]?.total ?? 0) };
    },

    async insert(input) {
      try {
        const { rows } = await db.query<WarehouseRow>(
          `INSERT INTO warehouses (code, name, active) VALUES ($1, $2, $3) RETURNING ${COLUMNS}`,
          [input.code, input.name, input.active],
        );
        const row = rows[0];
        if (!row) {
          throw new Error('El INSERT no devolvió la fila creada');
        }
        return toWarehouse(row);
      } catch (err) {
        throw isUniqueViolation(err) ? duplicateCode() : err;
      }
    },

    async update(id, input) {
      try {
        const { rows } = await db.query<WarehouseRow>(
          `UPDATE warehouses SET code = $2, name = $3, active = $4 WHERE id = $1
           RETURNING ${COLUMNS}`,
          [id, input.code, input.name, input.active],
        );
        const row = rows[0];
        return row ? toWarehouse(row) : null;
      } catch (err) {
        throw isUniqueViolation(err) ? duplicateCode() : err;
      }
    },
  };
}
