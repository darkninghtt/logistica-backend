-- Up Migration
-- Solo se guarda el hash SHA-256 del refresh token, nunca el valor que viaja en la cookie.
-- Todos los tokens que salen de un mismo login comparten family_id: si se reutiliza uno ya
-- rotado, se revoca la familia completa.
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users (id),
  family_id   UUID NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);

-- Down Migration
DROP TABLE refresh_tokens;
