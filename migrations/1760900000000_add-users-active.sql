-- Up Migration
-- Un usuario desactivado no puede iniciar sesión ni renovar su sesión
ALTER TABLE users ADD COLUMN active BOOLEAN NOT NULL DEFAULT true;

-- Down Migration
ALTER TABLE users DROP COLUMN active;
