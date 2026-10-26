import { assertRole, type Actor } from '../domain/authorization';
import { ConflictError, ForbiddenError, NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import type { StockBalance } from '../domain/stock';
import {
  assertTransition,
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
}

export interface TransferItemRow {
  productId: string;
  quantitySent: number;
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
}

export interface TransfersDeps {
  store: TransferReadStore;
  runInTransaction<T>(work: (tx: TransferTx) => Promise<T>): Promise<T>;
  access: WarehouseAccess;
}

const CREATE_ROLES = ['WAREHOUSE_MANAGER', 'OPERATOR'] as const;
const DISPATCH_ROLES = ['WAREHOUSE_MANAGER'] as const;
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
  };
}
