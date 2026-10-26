-- Up Migration
-- El libro admite los seis tipos de movimiento y puede apuntar a un traspaso y guardar un motivo
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (
  type IN ('ENTRY', 'TRANSFER_OUT', 'TRANSFER_IN', 'SHRINKAGE', 'TRANSIT_SHRINKAGE', 'ADJUSTMENT_IN')
);
ALTER TABLE stock_movements ADD COLUMN reason TEXT;
ALTER TABLE stock_movements ADD COLUMN transfer_id UUID REFERENCES transfers (id);

CREATE INDEX stock_movements_transfer_idx ON stock_movements (transfer_id) WHERE transfer_id IS NOT NULL;

-- Down Migration
-- Solo para desarrollo: los movimientos de los tipos nuevos se descartan para poder restaurar el CHECK
ALTER TABLE stock_movements DISABLE TRIGGER stock_movements_no_update_delete;
DELETE FROM stock_movements WHERE type <> 'ENTRY';
ALTER TABLE stock_movements ENABLE TRIGGER stock_movements_no_update_delete;
DROP INDEX stock_movements_transfer_idx;
ALTER TABLE stock_movements DROP COLUMN transfer_id;
ALTER TABLE stock_movements DROP COLUMN reason;
ALTER TABLE stock_movements DROP CONSTRAINT stock_movements_type_check;
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_type_check CHECK (type IN ('ENTRY'));
