import type { Pool, PoolClient } from 'pg';
import { roleSchema, type Role, type UserRecord } from '../domain/user';

interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  name: string;
  role: string;
  active: boolean;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
}

export interface UsersRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Inserta el usuario; si el correo ya existe no hace nada y devuelve false. */
  insertIfAbsent(user: NewUser): Promise<boolean>;
}

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

/** Solo SQL. Recibe el pool o el cliente de una transacción. */
export function createUsersRepository(db: Pool | PoolClient): UsersRepository {
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
  };
}
