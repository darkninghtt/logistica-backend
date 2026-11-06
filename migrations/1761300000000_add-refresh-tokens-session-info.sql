-- Up Migration
-- Sesiones activas: cada familia de refresh tokens es una sesión. Se guarda desde qué navegador se
-- abrió (User-Agent) y cuándo se usó por última vez (login o renovación) para mostrarlas al usuario.
ALTER TABLE refresh_tokens
  ADD COLUMN user_agent   TEXT,
  ADD COLUMN last_used_at TIMESTAMPTZ;

-- Listar y revocar las sesiones de un usuario filtra por user_id
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

-- Down Migration
DROP INDEX refresh_tokens_user_idx;
ALTER TABLE refresh_tokens
  DROP COLUMN last_used_at,
  DROP COLUMN user_agent;
