-- Up Migration
-- Traspasos entre bodegas: DRAFT -> IN_TRANSIT -> RECEIVED | DISCREPANCY -> RESOLVED, y CANCELLED desde DRAFT
CREATE TABLE transfers (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  origin_warehouse_id      UUID NOT NULL REFERENCES warehouses (id),
  destination_warehouse_id UUID NOT NULL REFERENCES warehouses (id),
  status                   TEXT NOT NULL DEFAULT 'DRAFT',
  note                     TEXT,
  created_by               UUID NOT NULL REFERENCES users (id),
  dispatched_by            UUID REFERENCES users (id),
  dispatched_at            TIMESTAMPTZ,
  received_by              UUID REFERENCES users (id),
  received_at              TIMESTAMPTZ,
  resolved_by              UUID REFERENCES users (id),
  resolved_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfers_status_check CHECK (
    status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'DISCREPANCY', 'RESOLVED', 'CANCELLED')
  ),
  CONSTRAINT transfers_warehouses_differ_check CHECK (origin_warehouse_id <> destination_warehouse_id)
);

CREATE INDEX transfers_origin_idx ON transfers (origin_warehouse_id);
CREATE INDEX transfers_destination_idx ON transfers (destination_warehouse_id);
CREATE INDEX transfers_status_idx ON transfers (status);

-- Ítems del traspaso. El costo se congela al despachar (hasta entonces es NULL).
CREATE TABLE transfer_items (
  transfer_id       UUID NOT NULL REFERENCES transfers (id),
  product_id        UUID NOT NULL REFERENCES products (id),
  quantity_sent     INTEGER NOT NULL,
  unit_cost         NUMERIC(14,4),
  quantity_received INTEGER,
  PRIMARY KEY (transfer_id, product_id),
  CONSTRAINT transfer_items_quantity_sent_check CHECK (quantity_sent > 0),
  CONSTRAINT transfer_items_unit_cost_check CHECK (unit_cost IS NULL OR unit_cost >= 0),
  CONSTRAINT transfer_items_quantity_received_check CHECK (quantity_received IS NULL OR quantity_received >= 0)
);

-- Línea de eventos auditable: quién, cuándo, estado anterior y nuevo, motivo
CREATE TABLE transfer_events (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transfer_id UUID NOT NULL REFERENCES transfers (id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  actor_id    UUID NOT NULL REFERENCES users (id),
  reason      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT transfer_events_to_status_check CHECK (
    to_status IN ('DRAFT', 'IN_TRANSIT', 'RECEIVED', 'DISCREPANCY', 'RESOLVED', 'CANCELLED')
  )
);

CREATE INDEX transfer_events_transfer_idx ON transfer_events (transfer_id, id);

-- Igual que el libro de movimientos: solo INSERT (TRUNCATE queda para limpiar la BD de pruebas)
CREATE FUNCTION transfer_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'transfer_events es inmutable: solo admite INSERT';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER transfer_events_no_update_delete
  BEFORE UPDATE OR DELETE ON transfer_events
  FOR EACH ROW EXECUTE FUNCTION transfer_events_immutable();

-- Down Migration
DROP TRIGGER transfer_events_no_update_delete ON transfer_events;
DROP FUNCTION transfer_events_immutable();
DROP TABLE transfer_events;
DROP TABLE transfer_items;
DROP TABLE transfers;
