import type { Pool, PoolClient } from 'pg';
import { NotFoundError } from '../domain/errors';
import type {
  TransferDetail,
  TransferEventView,
  TransferItemView,
  TransferStatus,
  TransferSummary,
  WarehouseRef,
} from '../domain/transfer';
import type { TransferHead, TransferReadStore, TransferWriteStore } from '../services/transfers';

const FOREIGN_KEY_VIOLATION = '23503';

interface SummaryRow {
  id: string;
  status: TransferStatus;
  note: string | null;
  created_by: string;
  dispatched_by: string | null;
  dispatched_at: Date | null;
  received_by: string | null;
  received_at: Date | null;
  resolved_by: string | null;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
  origin_id: string;
  origin_code: string;
  origin_name: string;
  destination_id: string;
  destination_code: string;
  destination_name: string;
  item_count: string;
}

interface ItemRow {
  product_id: string;
  sku: string;
  name: string;
  quantity_sent: number;
  quantity_received: number | null;
  unit_cost: string | null;
}

interface EventRow {
  from_status: TransferStatus | null;
  to_status: TransferStatus;
  actor_id: string;
  actor_name: string;
  reason: string | null;
  created_at: Date;
}

const SELECT_TRANSFER = `
  SELECT t.id, t.status, t.note, t.created_by, t.dispatched_by, t.dispatched_at, t.received_by,
         t.received_at, t.resolved_by, t.resolved_at, t.created_at, t.updated_at,
         o.id AS origin_id, o.code AS origin_code, o.name AS origin_name,
         d.id AS destination_id, d.code AS destination_code, d.name AS destination_name,
         (SELECT count(*) FROM transfer_items i WHERE i.transfer_id = t.id) AS item_count
  FROM transfers t
  JOIN warehouses o ON o.id = t.origin_warehouse_id
  JOIN warehouses d ON d.id = t.destination_warehouse_id`;

function iso(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

function toSummary(row: SummaryRow): TransferSummary {
  const origin: WarehouseRef = { id: row.origin_id, code: row.origin_code, name: row.origin_name };
  const destination: WarehouseRef = {
    id: row.destination_id,
    code: row.destination_code,
    name: row.destination_name,
  };
  return {
    id: row.id,
    status: row.status,
    origin,
    destination,
    itemCount: Number(row.item_count),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toItem(row: ItemRow): TransferItemView {
  return {
    productId: row.product_id,
    productSku: row.sku,
    productName: row.name,
    quantitySent: row.quantity_sent,
    quantityReceived: row.quantity_received,
    unitCost: row.unit_cost,
  };
}

function toEvent(row: EventRow): TransferEventView {
  return {
    fromStatus: row.from_status,
    toStatus: row.to_status,
    actor: { id: row.actor_id, name: row.actor_name },
    reason: row.reason,
    createdAt: row.created_at.toISOString(),
  };
}

/** Traduce la violación de clave foránea a un 404 que dice qué recurso falta. */
function missingReference(err: unknown): NotFoundError | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  if (err.code !== FOREIGN_KEY_VIOLATION) return null;
  const constraint = 'constraint' in err ? err.constraint : undefined;
  if (constraint === 'transfer_items_product_id_fkey') {
    return new NotFoundError('Algún producto del traspaso no existe');
  }
  if (
    constraint === 'transfers_origin_warehouse_id_fkey' ||
    constraint === 'transfers_destination_warehouse_id_fkey'
  ) {
    return new NotFoundError('La bodega no existe');
  }
  return null;
}

/** Lectura: sirve con el pool (sin transacción) o con el cliente de una transacción. */
export function createTransfersReadRepository(db: Pool | PoolClient): TransferReadStore {
  return {
    async list(filter, limit, offset) {
      // Filtros opcionales con una sola consulta: `$n IS NULL` desactiva el filtro
      const params = [
        filter.status ?? null,
        filter.warehouseId ?? null,
        filter.visibleWarehouseIds,
      ];
      const where = `
        WHERE ($1::text IS NULL OR t.status = $1::text)
          AND ($2::uuid IS NULL OR t.origin_warehouse_id = $2::uuid OR t.destination_warehouse_id = $2::uuid)
          AND ($3::uuid[] IS NULL OR t.origin_warehouse_id = ANY($3::uuid[]) OR t.destination_warehouse_id = ANY($3::uuid[]))`;
      const { rows } = await db.query<SummaryRow>(
        `${SELECT_TRANSFER} ${where} ORDER BY t.created_at DESC, t.id LIMIT $4 OFFSET $5`,
        [...params, limit, offset],
      );
      const count = await db.query<{ total: string }>(
        `SELECT count(*) AS total FROM transfers t ${where}`,
        params,
      );
      return { rows: rows.map(toSummary), total: Number(count.rows[0]?.total ?? 0) };
    },

    async findDetail(id) {
      const { rows } = await db.query<SummaryRow>(`${SELECT_TRANSFER} WHERE t.id = $1`, [id]);
      const row = rows[0];
      if (!row) return null;
      const items = await db.query<ItemRow>(
        `SELECT i.product_id, p.sku, p.name, i.quantity_sent, i.quantity_received, i.unit_cost
         FROM transfer_items i JOIN products p ON p.id = i.product_id
         WHERE i.transfer_id = $1 ORDER BY lower(p.sku)`,
        [id],
      );
      const events = await db.query<EventRow>(
        `SELECT e.from_status, e.to_status, e.actor_id, u.name AS actor_name, e.reason, e.created_at
         FROM transfer_events e JOIN users u ON u.id = e.actor_id
         WHERE e.transfer_id = $1 ORDER BY e.id`,
        [id],
      );
      const summary = toSummary(row);
      return {
        id: summary.id,
        status: summary.status,
        origin: summary.origin,
        destination: summary.destination,
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
        note: row.note,
        createdBy: row.created_by,
        dispatchedBy: row.dispatched_by,
        dispatchedAt: iso(row.dispatched_at),
        receivedBy: row.received_by,
        receivedAt: iso(row.received_at),
        resolvedBy: row.resolved_by,
        resolvedAt: iso(row.resolved_at),
        items: items.rows.map(toItem),
        events: events.rows.map(toEvent),
      } satisfies TransferDetail;
    },

    async findHead(id): Promise<TransferHead | null> {
      const { rows } = await db.query<{
        id: string;
        status: TransferStatus;
        origin_warehouse_id: string;
        destination_warehouse_id: string;
        created_by: string;
        received_by: string | null;
      }>(
        `SELECT id, status, origin_warehouse_id, destination_warehouse_id, created_by, received_by
         FROM transfers WHERE id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        id: row.id,
        status: row.status,
        originId: row.origin_warehouse_id,
        destinationId: row.destination_warehouse_id,
        createdBy: row.created_by,
        receivedBy: row.received_by,
      };
    },
  };
}

/** Escritura: recibe el cliente de la transacción, así todo lo que haga queda dentro de ella. */
export function createTransfersWriteRepository(client: PoolClient): TransferWriteStore {
  return {
    findHead: createTransfersReadRepository(client).findHead,

    async insertTransfer(input) {
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO transfers (origin_warehouse_id, destination_warehouse_id, note, created_by)
           VALUES ($1, $2, $3, $4) RETURNING id`,
          [input.originId, input.destinationId, input.note, input.createdBy],
        );
        const id = rows[0]?.id;
        if (!id) throw new Error('El INSERT no devolvió el traspaso creado');
        for (const item of input.items) {
          await client.query(
            'INSERT INTO transfer_items (transfer_id, product_id, quantity_sent) VALUES ($1, $2, $3)',
            [id, item.productId, item.quantity],
          );
        }
        return id;
      } catch (err) {
        throw missingReference(err) ?? err;
      }
    },

    async transition(id, from, to, actorId) {
      // Un solo UPDATE condicional para todas las transiciones: según el estado nuevo marca quién y cuándo
      const { rowCount } = await client.query(
        `UPDATE transfers SET
           status = $3::text,
           updated_at = now(),
           dispatched_by = CASE WHEN $3::text = 'IN_TRANSIT' THEN $4::uuid ELSE dispatched_by END,
           dispatched_at = CASE WHEN $3::text = 'IN_TRANSIT' THEN now() ELSE dispatched_at END,
           received_by = CASE WHEN $3::text IN ('RECEIVED', 'DISCREPANCY') THEN $4::uuid ELSE received_by END,
           received_at = CASE WHEN $3::text IN ('RECEIVED', 'DISCREPANCY') THEN now() ELSE received_at END,
           resolved_by = CASE WHEN $3::text = 'RESOLVED' THEN $4::uuid ELSE resolved_by END,
           resolved_at = CASE WHEN $3::text = 'RESOLVED' THEN now() ELSE resolved_at END
         WHERE id = $1 AND status = $2::text`,
        [id, from, to, actorId],
      );
      return rowCount === 1;
    },

    async insertEvent(event) {
      await client.query(
        `INSERT INTO transfer_events (transfer_id, from_status, to_status, actor_id, reason)
         VALUES ($1, $2, $3, $4, $5)`,
        [event.transferId, event.fromStatus, event.toStatus, event.actorId, event.reason],
      );
    },

    async listItems(transferId) {
      const { rows } = await client.query<{
        product_id: string;
        quantity_sent: number;
        unit_cost: string | null;
        quantity_received: number | null;
      }>(
        `SELECT product_id, quantity_sent, unit_cost, quantity_received
         FROM transfer_items WHERE transfer_id = $1 ORDER BY product_id`,
        [transferId],
      );
      return rows.map((row) => ({
        productId: row.product_id,
        quantitySent: row.quantity_sent,
        unitCost: row.unit_cost,
        quantityReceived: row.quantity_received,
      }));
    },

    async setReceivedQuantity(transferId, productId, quantity) {
      await client.query(
        'UPDATE transfer_items SET quantity_received = $3 WHERE transfer_id = $1 AND product_id = $2',
        [transferId, productId, quantity],
      );
    },

    async freezeItemCost(transferId, productId, unitCost) {
      await client.query(
        'UPDATE transfer_items SET unit_cost = $3 WHERE transfer_id = $1 AND product_id = $2',
        [transferId, productId, unitCost],
      );
    },
  };
}
