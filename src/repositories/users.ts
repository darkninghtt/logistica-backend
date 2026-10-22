import type { Pool, PoolClient } from 'pg';
import { ConflictError, NotFoundError } from '../domain/errors';
import { roleSchema, type ManagedUser, type Role, type UserRecord } from '../domain/user';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  active: boolean;
}

interface ManagedUserRow {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
  created_at: Date;
  warehouse_ids: string[];
}

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
}

export interface UserChanges {
  email: string;
  name: string;
  role: Role;
  active: boolean;
  /** Si viene, reemplaza la contraseña; si no, se conserva la actual. */
  passwordHash?: string;
}

export interface UsersRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Inserta el usuario; si el correo ya existe no hace nada y devuelve false. */
  insertIfAbsent(user: NewUser): Promise<boolean>;
  /** Una página de usuarios ordenados por correo, y el total. */
  list(limit: number, offset: number): Promise<{ rows: ManagedUser[]; total: number }>;
  findManagedById(id: string): Promise<ManagedUser | null>;
  /** Inserta el usuario; un correo repetido lanza ConflictError. */
  insert(user: NewUser & { active: boolean }): Promise<ManagedUser>;
  /** Reemplaza los datos del usuario. Devuelve null si el id no existe. */
  update(id: string, changes: UserChanges): Promise<ManagedUser | null>;
  /** Reemplaza las bodegas asignadas en una sola instrucción. Una bodega inexistente lanza NotFoundError. */
  replaceWarehouses(userId: string, warehouseIds: string[]): Promise<void>;
  /** Ids de las bodegas asignadas al usuario. */
  warehouseIdsOf(userId: string): Promise<string[]>;
  /** Agrega bodegas sin quitar las que ya tiene (lo usa el seed). */
  addWarehouses(userId: string, warehouseIds: string[]): Promise<void>;
}

const UNIQUE_VIOLATION = '23505';
const FOREIGN_KEY_VIOLATION = '23503';

const MANAGED_SELECT = `
  SELECT u.id, u.email, u.name, u.role, u.active, u.created_at,
         COALESCE((SELECT array_agg(uw.warehouse_id::text ORDER BY uw.warehouse_id)
                   FROM user_warehouses uw WHERE uw.user_id = u.id), '{}') AS warehouse_ids
  FROM users u`;

function toRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    name: row.name,
    role: roleSchema.parse(row.role),
    active: row.active,
  };
}

function toManaged(row: ManagedUserRow): ManagedUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: roleSchema.parse(row.role),
    active: row.active,
    warehouseIds: row.warehouse_ids,
    createdAt: row.created_at.toISOString(),
  };
}

function hasCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

/** El índice único de la BD decide (sin carreras): su error se traduce a un ConflictError. */
function duplicateEmail(): ConflictError {
  return new ConflictError('Ya existe un usuario con ese correo');
}

/** Solo SQL. Recibe el pool o el cliente de una transacción. */
export function createUsersRepository(db: Pool | PoolClient): UsersRepository {
  async function findManaged(id: string): Promise<ManagedUser | null> {
    const { rows } = await db.query<ManagedUserRow>(`${MANAGED_SELECT} WHERE u.id = $1`, [id]);
    const row = rows[0];
    return row ? toManaged(row) : null;
  }

  return {
    async findByEmail(email) {
      const { rows } = await db.query<UserRow>(
        'SELECT id, email, password_hash, name, role, active FROM users WHERE lower(email) = lower($1)',
        [email],
      );
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async findById(id) {
      const { rows } = await db.query<UserRow>(
        'SELECT id, email, password_hash, name, role, active FROM users WHERE id = $1',
        [id],
      );
      const row = rows[0];
      return row ? toRecord(row) : null;
    },

    async insertIfAbsent(user) {
      const result = await db.query(
        `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING`,
        [user.email, user.passwordHash, user.name, user.role],
      );
      return result.rowCount === 1;
    },

    async list(limit, offset) {
      const { rows } = await db.query<ManagedUserRow>(
        `${MANAGED_SELECT} ORDER BY lower(u.email) LIMIT $1 OFFSET $2`,
        [limit, offset],
      );
      const count = await db.query<{ total: string }>('SELECT count(*) AS total FROM users');
      return { rows: rows.map(toManaged), total: Number(count.rows[0]?.total ?? 0) };
    },

    findManagedById: findManaged,

    async insert(user) {
      try {
        const { rows } = await db.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, name, role, active)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [user.email, user.passwordHash, user.name, user.role, user.active],
        );
        const created = rows[0] ? await findManaged(rows[0].id) : null;
        if (!created) {
          throw new Error('El INSERT no devolvió el usuario creado');
        }
        return created;
      } catch (err) {
        throw hasCode(err, UNIQUE_VIOLATION) ? duplicateEmail() : err;
      }
    },

    async update(id, changes) {
      try {
        const result = await db.query(
          `UPDATE users
           SET email = $2, name = $3, role = $4, active = $5,
               password_hash = COALESCE($6, password_hash)
           WHERE id = $1`,
          [
            id,
            changes.email,
            changes.name,
            changes.role,
            changes.active,
            changes.passwordHash ?? null,
          ],
        );
        return result.rowCount === 1 ? await findManaged(id) : null;
      } catch (err) {
        throw hasCode(err, UNIQUE_VIOLATION) ? duplicateEmail() : err;
      }
    },

    // Una sola instrucción (atómica): quita las que sobran e inserta las que faltan
    async replaceWarehouses(userId, warehouseIds) {
      try {
        await db.query(
          `WITH removed AS (
             DELETE FROM user_warehouses
             WHERE user_id = $1 AND NOT (warehouse_id = ANY($2::uuid[]))
           )
           INSERT INTO user_warehouses (user_id, warehouse_id)
           SELECT $1, w FROM unnest($2::uuid[]) AS w
           ON CONFLICT DO NOTHING`,
          [userId, warehouseIds],
        );
      } catch (err) {
        throw hasCode(err, FOREIGN_KEY_VIOLATION)
          ? new NotFoundError('Alguna de las bodegas no existe')
          : err;
      }
    },

    async warehouseIdsOf(userId) {
      const { rows } = await db.query<{ warehouse_id: string }>(
        'SELECT warehouse_id FROM user_warehouses WHERE user_id = $1',
        [userId],
      );
      return rows.map((row) => row.warehouse_id);
    },

    async addWarehouses(userId, warehouseIds) {
      await db.query(
        `INSERT INTO user_warehouses (user_id, warehouse_id)
         SELECT $1, w FROM unnest($2::uuid[]) AS w
         ON CONFLICT DO NOTHING`,
        [userId, warehouseIds],
      );
    },
  };
}
