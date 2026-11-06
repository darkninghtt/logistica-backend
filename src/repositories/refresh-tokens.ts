import type { Pool, PoolClient } from 'pg';
import type { RefreshTokenStore } from '../services/sessions';

interface TokenRow {
  user_id: string;
  family_id: string;
  used_at: Date | null;
  revoked_at: Date | null;
}

interface ActiveFamilyRow {
  family_id: string;
  user_agent: string | null;
  created_at: Date;
  last_used_at: Date | null;
}

/** Solo SQL. Solo recibe y guarda el hash del token, nunca su valor. */
export function createRefreshTokensRepository(db: Pool | PoolClient): RefreshTokenStore {
  return {
    // `last_used_at` = ahora: cada token nace al iniciar sesión o al renovarla
    async insert({ userId, familyId, tokenHash, expiresAt, userAgent }) {
      await db.query(
        `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at, user_agent, last_used_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [userId, familyId, tokenHash, expiresAt, userAgent],
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

    // Una sesión activa es una familia con un token vigente (sin usar, sin revocar y sin vencer):
    // la rotación deja exactamente uno así por familia. Su inicio es el primer token de la familia.
    async listActive(userId) {
      const { rows } = await db.query<ActiveFamilyRow>(
        `SELECT t.family_id, t.user_agent, t.last_used_at,
                (SELECT min(f.created_at) FROM refresh_tokens f WHERE f.family_id = t.family_id)
                  AS created_at
         FROM refresh_tokens t
         WHERE t.user_id = $1 AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()
         ORDER BY t.last_used_at DESC NULLS LAST, t.family_id`,
        [userId],
      );
      return rows.map((row) => ({
        familyId: row.family_id,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        lastUsedAt: row.last_used_at,
      }));
    },

    // Solo revoca si la familia es de ese usuario y sigue activa: así no se puede cerrar una ajena
    async revokeFamilyOfUser(familyId, userId) {
      const result = await db.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE family_id = $1 AND user_id = $2 AND revoked_at IS NULL
           AND EXISTS (
             SELECT 1 FROM refresh_tokens a
             WHERE a.family_id = $1 AND a.used_at IS NULL AND a.revoked_at IS NULL
               AND a.expires_at > now()
           )`,
        [familyId, userId],
      );
      return (result.rowCount ?? 0) > 0;
    },

    async revokeAllOfUser(userId, exceptFamilyId) {
      await db.query(
        `UPDATE refresh_tokens SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
           AND ($2::uuid IS NULL OR family_id <> $2::uuid)`,
        [userId, exceptFamilyId],
      );
    },
  };
}
