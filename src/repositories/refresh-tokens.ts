import type { Pool, PoolClient } from 'pg';
import type { RefreshTokenStore } from '../services/sessions';

interface TokenRow {
  user_id: string;
  family_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
}

/** Solo SQL. Solo recibe y guarda el hash del token, nunca su valor. */
export function createRefreshTokensRepository(db: Pool | PoolClient): RefreshTokenStore {
  return {
    async insert({ userId, familyId, tokenHash, expiresAt }) {
      await db.query(
        'INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)',
        [userId, familyId, tokenHash, expiresAt],
      );
    },

    // Atómico: el UPDATE solo afecta a un token sin usar, vigente y sin revocar. Si dos
    // peticiones llegan a la vez con el mismo token, solo una recibe la fila.
    async consume(tokenHash) {
      const { rows } = await db.query<TokenRow>(
        `UPDATE refresh_tokens SET used_at = now()
         WHERE token_hash = $1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > now()
         RETURNING user_id, family_id, used_at, revoked_at`,
        [tokenHash],
      );
      const row = rows[0];
      return row ? { userId: row.user_id, familyId: row.family_id } : null;
    },

    async find(tokenHash) {
      const { rows } = await db.query<TokenRow>(
        'SELECT user_id, family_id, used_at, revoked_at FROM refresh_tokens WHERE token_hash = $1',
        [tokenHash],
      );
      const row = rows[0];
      return row
        ? {
            userId: row.user_id,
            familyId: row.family_id,
            used: row.used_at !== null,
            revoked: row.revoked_at !== null,
          }
        : null;
    },

    async revokeFamily(familyId) {
      await db.query(
        'UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL',
        [familyId],
      );
    },
  };
}
