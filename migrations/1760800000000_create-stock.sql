-- Up Migration
-- Existencias por producto y bodega. Cantidades enteras; costos en NUMERIC(14,4).
CREATE TABLE stock_levels (
  product_id   UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 0,
  avg_cost     NUMERIC(14,4) NOT NULL DEFAULT 0,
  version      INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, warehouse_id),
  CONSTRAINT stock_levels_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT stock_levels_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  -- Última defensa: el servicio ya valida, pero la BD nunca debe aceptar existencias negativas
  CONSTRAINT stock_levels_quantity_check CHECK (quantity >= 0),
  CONSTRAINT stock_levels_avg_cost_check CHECK (avg_cost >= 0)
);

-- Libro de movimientos: solo INSERT. Cada fila guarda el saldo y el costo resultantes.
CREATE TABLE stock_movements (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id       UUID NOT NULL,
  warehouse_id     UUID NOT NULL,
  type             TEXT NOT NULL,
  quantity         INTEGER NOT NULL,
  unit_cost        NUMERIC(14,4) NOT NULL,
  balance_qty      INTEGER NOT NULL,
  balance_avg_cost NUMERIC(14,4) NOT NULL,
  created_by       UUID NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT stock_movements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products (id),
  CONSTRAINT stock_movements_warehouse_id_fkey FOREIGN KEY (warehouse_id) REFERENCES warehouses (id),
  CONSTRAINT stock_movements_created_by_fkey FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT stock_movements_type_check CHECK (type IN ('ENTRY')),
  CONSTRAINT stock_movements_quantity_check CHECK (quantity > 0),
  CONSTRAINT stock_movements_unit_cost_check CHECK (unit_cost >= 0),
  CONSTRAINT stock_movements_balance_check CHECK (balance_qty >= 0 AND balance_avg_cost >= 0)
);

CREATE INDEX stock_movements_lookup_idx ON stock_movements (warehouse_id, product_id, id);

-- El libro es inmutable: ni UPDATE ni DELETE (TRUNCATE queda para limpiar la BD de pruebas)
CREATE FUNCTION stock_movements_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'stock_movements es un libro inmutable: solo admite INSERT';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER stock_movements_no_update_delete
  BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION stock_movements_immutable();

-- Down Migration
DROP TRIGGER stock_movements_no_update_delete ON stock_movements;
DROP FUNCTION stock_movements_immutable();
DROP TABLE stock_movements;
DROP TABLE stock_levels;
