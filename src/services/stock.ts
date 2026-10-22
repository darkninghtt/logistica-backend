import {
  applyEntry,
  type StockBalance,
  type StockLevel,
  type StockMovement,
} from '../domain/stock';
import { assertRole, type Actor } from '../domain/authorization';
import type { StockEntryInput } from '../schemas/stock';
import type { WarehouseAccess } from './warehouse-access';

/** Datos de un movimiento nuevo (el libro le pone id y fecha). */
export interface NewMovement {
  productId: string;
  warehouseId: string;
  type: StockMovement['type'];
  quantity: number;
  unitCost: string;
  balanceQty: number;
  balanceAvgCost: string;
  createdBy: string;
}

/** Lo que el servicio necesita de la persistencia; todo corre dentro de la misma transacción. */
export interface StockStore {
  /**
   * Crea el nivel en 0 si no existe (así hay una fila que bloquear).
   * Lanza NotFoundError si el producto o la bodega no existen.
   */
  ensureLevel(productId: string, warehouseId: string): Promise<void>;
  /** Lee el nivel con SELECT ... FOR UPDATE: nadie más lo modifica hasta el COMMIT. */
  lockLevel(productId: string, warehouseId: string): Promise<StockBalance>;
  saveLevel(productId: string, warehouseId: string, balance: StockBalance): Promise<StockLevel>;
  insertMovement(movement: NewMovement): Promise<StockMovement>;
}

export interface StockEntryResult {
  movement: StockMovement;
  stockLevel: StockLevel;
}

export interface StockService {
  registerEntry(input: StockEntryInput, actor: Actor): Promise<StockEntryResult>;
}

export interface StockDeps {
  /** Abre una transacción y entrega el almacén ligado a ella (COMMIT si termina, ROLLBACK si falla). */
  runInTransaction<T>(work: (store: StockStore) => Promise<T>): Promise<T>;
  access: WarehouseAccess;
}

/** Quién puede registrar entradas: el ADMIN en cualquier bodega, el jefe solo en las suyas. */
const ENTRY_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER'] as const;

export function createStockService({ runInTransaction, access }: StockDeps): StockService {
  return {
    async registerEntry(input, actor) {
      assertRole(actor, ENTRY_ROLES);
      await access.assert(actor, input.warehouseId);
      return runInTransaction(async (store) => {
        const { productId, warehouseId } = input;
        await store.ensureLevel(productId, warehouseId);
        const current = await store.lockLevel(productId, warehouseId);
        const next = applyEntry(current, { quantity: input.quantity, unitCost: input.unitCost });

        const stockLevel = await store.saveLevel(productId, warehouseId, next);
        const movement = await store.insertMovement({
          productId,
          warehouseId,
          type: 'ENTRY',
          quantity: input.quantity,
          unitCost: input.unitCost,
          balanceQty: next.quantity,
          balanceAvgCost: next.avgCost,
          createdBy: actor.userId,
        });
        return { movement, stockLevel };
      });
    },
  };
}
