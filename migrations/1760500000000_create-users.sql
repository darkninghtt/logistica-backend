-- Up Migration
CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL
                CHECK (role IN ('ADMIN', 'WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El correo es único sin distinguir mayúsculas
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

-- Down Migration
DROP TABLE users;
