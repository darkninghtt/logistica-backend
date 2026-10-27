import { assertRole, type Actor } from '../domain/authorization';
import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import { applyEntry, type StockBalance } from '../domain/stock';
import {
  assertTransition,
  computeReceipt,
  withoutTransferCosts,
  type TransferDetail,
  type TransferDetailNoCost,
  type TransferStatus,
  type TransferSummary,
} from '../domain/transfer';
import type {
  CancelTransferInput,
  CreateTransferInput,
  ListTransfersQuery,
  ReceiveTransferInput,
  ResolveTransferInput,
} from '../schemas/transfers';
import type { StockStore } from './stock';
import type { WarehouseAccess } from './warehouse-access';

/** Lo mínimo de un traspaso para decidir permisos y transiciones. */
export interface TransferHead {
  id: string;
  status: TransferStatus;
  originId: string;
  destinationId: string;
  createdBy: string;
  /** Quién declaró la recepción; null hasta que el destino recibe. */
  receivedBy: string | null;
}

export interface TransferItemRow {
  productId: string;
  quantitySent: number;
  /** Costo congelado al despachar; null mientras es borrador. */
  unitCost: string | null;
  /** Lo que declaró el destino; null hasta que recibe. */
  quantityReceived: number | null;
}

export interface TransferFilter {
  status?: TransferStatus;
  warehouseId?: string;
  /** Bodegas visibles para quien consulta; null significa todas. */
  visibleWarehouseIds: string[] | null;
}

/** Lectura de traspasos (no necesita transacción). */
export interface TransferReadStore {
  list(
    filter: TransferFilter,
    limit: number,
    offset: number,
  ): Promise<{ rows: TransferSummary[]; total: number }>;
  findDetail(id: string): Promise<TransferDetail | null>;
  findHead(id: string): Promise<TransferHead | null>;
}

/** Escritura de traspasos: siempre dentro de una transacción. */
export interface TransferWriteStore {
  /** Lanza NotFoundError si la bodega de destino o un producto no existen. */
  insertTransfer(input: {
    originId: string;
    destinationId: string;
    note: string | null;
    createdBy: string;
    items: { productId: string; quantity: number }[];
  }): Promise<string>;
  /** UPDATE ... WHERE id AND status = from. Devuelve false si el estado ya no era `from`. */
  transition(
    id: string,
    from: TransferStatus,
    to: TransferStatus,
    actorId: string,
  ): Promise<boolean>;
  insertEvent(event: {
    transferId: string;
    fromStatus: TransferStatus | null;
    toStatus: TransferStatus;
    actorId: string;
    reason: string | null;
  }): Promise<void>;
  /** Ítems del traspaso ordenados por product_id (el orden de bloqueo del stock). */
  listItems(transferId: string): Promise<TransferItemRow[]>;
  freezeItemCost(transferId: string, productId: string, unitCost: string): Promise<void>;
  /** Guarda lo que el destino declaró recibir de un ítem. */
  setReceivedQuantity(transferId: string, productId: string, quantity: number): Promise<void>;
}

/** Todo lo que corre dentro de la misma transacción. */
export interface TransferTx {
  transfers: TransferWriteStore;
  stock: StockStore;
}

type TransferView = TransferDetail | TransferDetailNoCost;

export interface TransfersService {
  create(input: CreateTransferInput, actor: Actor): Promise<TransferView>;
  list(query: ListTransfersQuery, actor: Actor): Promise<Page<TransferSummary>>;
  get(id: string, actor: Actor): Promise<TransferView>;
  cancel(id: string, input: CancelTransferInput, actor: Actor): Promise<TransferView>;
  dispatch(id: string, actor: Actor): Promise<TransferView>;
  receive(id: string, input: ReceiveTransferInput, actor: Actor): Promise<TransferView>;
  resolve(id: string, input: ResolveTransferInput, actor: Actor): Promise<TransferView>;
}

export interface TransfersDeps {
  store: TransferReadStore;
  runInTransaction<T>(work: (tx: TransferTx) => Promise<T>): Promise<T>;
  access: WarehouseAccess;
}

const CREATE_ROLES = ['WAREHOUSE_MANAGER', 'OPERATOR'] as const;
const DISPATCH_ROLES = ['WAREHOUSE_MANAGER'] as const;
const RECEIVE_ROLES = ['WAREHOUSE_MANAGER', 'OPERATOR'] as const;
const RESOLVE_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER'] as const;
/** El OPERATOR no recibe costos (se quitan aquí, no en la interfaz). */
const ROLE_WITHOUT_COSTS = 'OPERATOR';

/**
 * Cambia el estado con la guarda `WHERE status = from` y deja el evento en la misma transacción.
 * Si la guarda no encuentra fila, otro ya lo cambió (o no existe): 409 o 404, sin tocar nada más.
 */
export async function moveStatus(
  tx: TransferTx,
  store: TransferReadStore,
  transferId: string,
  from: TransferStatus,
  to: TransferStatus,
  actorId: string,
  reason: string | null = null,
): Promise<void> {
  assertTransition(from, to);
  if (!(await tx.transfers.transition(transferId, from, to, actorId))) {
    const current = await store.findHead(transferId);
    if (!current) throw new NotFoundError('El traspaso no existe');
    throw new ConflictError(
      `El traspaso está en ${current.status} y no se puede pasar a ${to}`,
      'INVALID_TRANSITION',
    );
  }
  await tx.transfers.insertEvent({ transferId, fromStatus: from, toStatus: to, actorId, reason });
}

interface FrozenCostEntry {
  transferId: string;
  warehouseId: string;
  productId: string;
  quantity: number;
  /** Costo congelado del ítem al despachar. */
  unitCost: string | null;
  type: 'TRANSFER_IN' | 'ADJUSTMENT_IN';
  actorId: string;
  reason?: string;
}

/**
 * Entra stock a una bodega al costo congelado del traspaso y recalcula su CPP (función pura
 * `applyEntry`). Bloquea la fila de stock: quien llama debe recorrer los productos en orden.
 */
async function enterAtFrozenCost(stock: StockStore, entry: FrozenCostEntry): Promise<void> {
  if (entry.unitCost === null) {
    throw new Error('Un ítem despachado debería tener el costo congelado');
  }
  await stock.ensureLevel(entry.productId, entry.warehouseId);
  const current = await stock.lockLevel(entry.productId, entry.warehouseId);
  const next = applyEntry(current, { quantity: entry.quantity, unitCost: entry.unitCost });
  await stock.saveLevel(entry.productId, entry.warehouseId, next);
  await stock.insertMovement({
    productId: entry.productId,
    warehouseId: entry.warehouseId,
    type: entry.type,
    quantity: entry.quantity,
    unitCost: entry.unitCost,
    balanceQty: next.quantity,
    balanceAvgCost: next.avgCost,
    createdBy: entry.actorId,
    reason: entry.reason,
    transferId: entry.transferId,
  });
}

/** Separación de funciones: quien recibió el traspaso no puede resolver su discrepancia. */
function assertNotReceiver(receivedBy: string | null, actor: Actor): void {
  if (receivedBy === actor.userId) {
    throw new ForbiddenError('Quien recibió el traspaso no puede resolver su discrepancia');
  }
}

export function createTransfersService({
  store,
  runInTransaction,
  access,
}: TransfersDeps): TransfersService {
  async function requireHead(id: string): Promise<TransferHead> {
    const head = await store.findHead(id);
    if (!head) throw new NotFoundError('El traspaso no existe');
    return head;
  }

  /** ADMIN y AUDITOR ven todo; el resto, los traspasos donde su bodega es origen o destino. */
  async function assertCanView(head: TransferHead, actor: Actor): Promise<void> {
    const visible = await access.visibleIds(actor);
    if (visible && !visible.includes(head.originId) && !visible.includes(head.destinationId)) {
      throw new ForbiddenError('No tienes acceso a ese traspaso');
    }
  }

  async function detailFor(id: string, actor: Actor): Promise<TransferView> {
    const detail = await store.findDetail(id);
    if (!detail) throw new NotFoundError('El traspaso no existe');
    return actor.role === ROLE_WITHOUT_COSTS ? withoutTransferCosts(detail) : detail;
  }

  return {
    async create(input, actor) {
      assertRole(actor, CREATE_ROLES);
      await access.assert(actor, input.originWarehouseId);
      const id = await runInTransaction(async (tx) => {
        const transferId = await tx.transfers.insertTransfer({
          originId: input.originWarehouseId,
          destinationId: input.destinationWarehouseId,
          note: input.note ?? null,
          createdBy: actor.userId,
          items: input.items,
        });
        await tx.transfers.insertEvent({
          transferId,
          fromStatus: null,
          toStatus: 'DRAFT',
          actorId: actor.userId,
          reason: null,
        });
        return transferId;
      });
      return detailFor(id, actor);
    },

    async list(query, actor) {
      const visibleWarehouseIds = await access.visibleIds(actor);
      const { rows, total } = await store.list(
        { status: query.status, warehouseId: query.warehouseId, visibleWarehouseIds },
        query.pageSize,
        (query.page - 1) * query.pageSize,
      );
      return { data: rows, page: query.page, pageSize: query.pageSize, total };
    },

    async get(id, actor) {
      await assertCanView(await requireHead(id), actor);
      return detailFor(id, actor);
    },

    async cancel(id, input, actor) {
      assertRole(actor, CREATE_ROLES);
      const head = await requireHead(id);
      await access.assert(actor, head.originId);
      // El operario solo cancela lo que él creó; el jefe cancela cualquiera de su bodega
      if (actor.role === 'OPERATOR' && head.createdBy !== actor.userId) {
        throw new ForbiddenError('Solo puedes cancelar los traspasos que tú creaste');
      }
      await runInTransaction((tx) =>
        moveStatus(tx, store, id, 'DRAFT', 'CANCELLED', actor.userId, input.reason ?? null),
      );
      return detailFor(id, actor);
    },

    async dispatch(id, actor) {
      assertRole(actor, DISPATCH_ROLES);
      const head = await requireHead(id);
      await access.assert(actor, head.originId);
      await runInTransaction(async (tx) => {
        // 1) La fila del traspaso (UPDATE condicional): un despacho repetido se detiene aquí con 409
        await moveStatus(tx, store, id, 'DRAFT', 'IN_TRANSIT', actor.userId);

        // 2) El stock del origen, por product_id: siempre el mismo orden evita deadlocks
        for (const item of await tx.transfers.listItems(id)) {
          await tx.stock.ensureLevel(item.productId, head.originId);
          const current = await tx.stock.lockLevel(item.productId, head.originId);
          if (current.quantity < item.quantitySent) {
            throw new ConflictError(
              'No hay stock suficiente en la bodega de origen para despachar',
              'INSUFFICIENT_STOCK',
            );
          }
          // Salir stock no cambia el CPP: se descuenta al costo vigente y ese costo se congela
          const next: StockBalance = {
            quantity: current.quantity - item.quantitySent,
            avgCost: current.avgCost,
          };
          await tx.stock.saveLevel(item.productId, head.originId, next);
          await tx.stock.insertMovement({
            productId: item.productId,
            warehouseId: head.originId,
            type: 'TRANSFER_OUT',
            quantity: item.quantitySent,
            unitCost: current.avgCost,
            balanceQty: next.quantity,
            balanceAvgCost: next.avgCost,
            createdBy: actor.userId,
            transferId: id,
          });
          await tx.transfers.freezeItemCost(id, item.productId, current.avgCost);
        }
      });
      return detailFor(id, actor);
    },

    async receive(id, input, actor) {
      assertRole(actor, RECEIVE_ROLES);
      const head = await requireHead(id);
      await access.assert(actor, head.destinationId);
      await runInTransaction(async (tx) => {
        // Los ítems no cambian después del borrador; la declaración se valida antes de tocar nada
        const items = await tx.transfers.listItems(id);
        const receipt = computeReceipt(items, input.items);

        // 1) La fila del traspaso: una recepción repetida se detiene aquí con 409
        await moveStatus(tx, store, id, 'IN_TRANSIT', receipt.status, actor.userId);

        // 2) El stock del destino, por product_id (el mismo orden de bloqueo que al despachar)
        for (const line of receipt.items) {
          await tx.transfers.setReceivedQuantity(id, line.productId, line.quantityReceived);
          // Entra min(recibido, enviado); un sobrante queda retenido hasta resolver
          if (line.entering === 0) continue;
          await enterAtFrozenCost(tx.stock, {
            transferId: id,
            warehouseId: head.destinationId,
            productId: line.productId,
            quantity: line.entering,
            unitCost: items.find((item) => item.productId === line.productId)?.unitCost ?? null,
            type: 'TRANSFER_IN',
            actorId: actor.userId,
          });
        }
      });
      return detailFor(id, actor);
    },

    async resolve(id, input, actor) {
      assertRole(actor, RESOLVE_ROLES);
      const head = await requireHead(id);
      await assertCanView(head, actor);
      assertNotReceiver(head.receivedBy, actor);
      await runInTransaction(async (tx) => {
        await moveStatus(tx, store, id, 'DISCREPANCY', 'RESOLVED', actor.userId, input.reason);
        // Se vuelve a comprobar con el estado ya bloqueado: si el traspaso se recibió justo después
        // de leerlo arriba, la persona que recibió igual no puede resolverlo
        assertNotReceiver((await store.findHead(id))?.receivedBy ?? null, actor);

        for (const item of await tx.transfers.listItems(id)) {
          if (item.quantityReceived === null) {
            throw new Error('Un traspaso con discrepancia debería tener las cantidades recibidas');
          }
          const shortfall = item.quantitySent - item.quantityReceived;
          const surplus = item.quantityReceived - item.quantitySent;
          if (shortfall > 0) {
            // Merma en tránsito: la mercancía ya salió del origen y nunca llegó. No mueve el stock
            // de ninguna bodega, así que el libro guarda el saldo y el costo del destino sin cambios
            await tx.stock.ensureLevel(item.productId, head.destinationId);
            const current = await tx.stock.lockLevel(item.productId, head.destinationId);
            await tx.stock.insertMovement({
              productId: item.productId,
              warehouseId: head.destinationId,
              type: 'TRANSIT_SHRINKAGE',
              quantity: shortfall,
              unitCost: item.unitCost ?? current.avgCost,
              balanceQty: current.quantity,
              balanceAvgCost: current.avgCost,
              createdBy: actor.userId,
              reason: input.reason,
              transferId: id,
            });
          } else if (surplus > 0) {
            // El sobrante entra al destino como ajuste, al costo congelado
            await enterAtFrozenCost(tx.stock, {
              transferId: id,
              warehouseId: head.destinationId,
              productId: item.productId,
              quantity: surplus,
              unitCost: item.unitCost,
              type: 'ADJUSTMENT_IN',
              actorId: actor.userId,
              reason: input.reason,
            });
          }
        }
      });
      return detailFor(id, actor);
    },
  };
}
