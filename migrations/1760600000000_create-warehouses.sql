-- Up Migration
CREATE TABLE warehouses (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code       TEXT NOT NULL,
  name       TEXT NOT NULL,
  active     BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El código es único sin distinguir mayúsculas
CREATE UNIQUE INDEX warehouses_code_key ON warehouses (lower(code));

-- Down Migration
DROP TABLE warehouses;
