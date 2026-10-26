import {
  applyEntry,
  applyShrinkage,
  levelWithoutCosts,
  movementWithoutCosts,
  shrinkageReasonText,
  type StockBalance,
  type StockLevel,
  type StockLevelNoCost,
  type StockMovement,
  type StockMovementNoCost,
} from '../domain/stock';
import { assertRole, type Actor } from '../domain/authorization';
import type { StockEntryInput, StockShrinkageInput } from '../schemas/stock';
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
  reason?: string;
  transferId?: string;
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

/** Lo que devuelve una merma; el OPERATOR la recibe sin campos de costo. */
export type StockShrinkageResult =
  StockEntryResult | { movement: StockMovementNoCost; stockLevel: StockLevelNoCost };

export interface StockService {
  registerEntry(input: StockEntryInput, actor: Actor): Promise<StockEntryResult>;
  registerShrinkage(input: StockShrinkageInput, actor: Actor): Promise<StockShrinkageResult>;
}

export interface StockDeps {
  /** Abre una transacción y entrega el almacén ligado a ella (COMMIT si termina, ROLLBACK si falla). */
  runInTransaction<T>(work: (store: StockStore) => Promise<T>): Promise<T>;
  access: WarehouseAccess;
}

/** Quién puede registrar entradas: el ADMIN en cualquier bodega, el jefe solo en las suyas. */
const ENTRY_ROLES = ['ADMIN', 'WAREHOUSE_MANAGER'] as const;
/** Quién puede registrar mermas: jefe y operario, solo en sus bodegas (el ADMIN y el AUDITOR no). */
const SHRINKAGE_ROLES = ['WAREHOUSE_MANAGER', 'OPERATOR'] as const;
/** Los costos son datos sensibles: el OPERATOR no los recibe (se quitan aquí, no en la interfaz). */
const ROLE_WITHOUT_COSTS = 'OPERATOR';

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

    async registerShrinkage(input, actor) {
      assertRole(actor, SHRINKAGE_ROLES);
      await access.assert(actor, input.warehouseId);
      const result = await runInTransaction(async (store) => {
        const { productId, warehouseId } = input;
        await store.ensureLevel(productId, warehouseId);
        // Con el nivel bloqueado, dos mermas simultáneas se ejecutan una tras otra
        const current = await store.lockLevel(productId, warehouseId);
        // Si no alcanza lanza 409 y el rollback deshace también el nivel recién creado
        const next = applyShrinkage(current, input.quantity);

        const stockLevel = await store.saveLevel(productId, warehouseId, next);
        // La merma se valora al costo vigente y no lo modifica
        const movement = await store.insertMovement({
          productId,
          warehouseId,
          type: 'SHRINKAGE',
          quantity: input.quantity,
          unitCost: current.avgCost,
          balanceQty: next.quantity,
          balanceAvgCost: next.avgCost,
          createdBy: actor.userId,
          reason: shrinkageReasonText(input.reason, input.note),
        });
        return { movement, stockLevel };
      });
      return actor.role === ROLE_WITHOUT_COSTS
        ? {
            movement: movementWithoutCosts(result.movement),
            stockLevel: levelWithoutCosts(result.stockLevel),
          }
        : result;
    },
  };
}
