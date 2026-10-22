-- Up Migration
-- Bodegas que puede operar cada usuario (la base de la autorización por bodega)
CREATE TABLE user_warehouses (
  user_id      UUID NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses (id),
  PRIMARY KEY (user_id, warehouse_id)
);

-- Para buscar a los usuarios de una bodega
CREATE INDEX user_warehouses_warehouse_idx ON user_warehouses (warehouse_id);

-- Down Migration
DROP TABLE user_warehouses;
