-- Up Migration
CREATE TABLE products (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku        TEXT NOT NULL,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- El SKU es único sin distinguir mayúsculas
CREATE UNIQUE INDEX products_sku_key ON products (lower(sku));

-- Down Migration
DROP TABLE products;
