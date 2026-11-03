import type { Role } from './user';
import { totalValue, type MovementType, type StockMovement } from './stock';

/**
 * Quién ve reportes, kardex y exportaciones: son datos de costo. ADMIN y AUDITOR, todas las
 * bodegas; el jefe de bodega, solo las asignadas; el OPERATOR, ninguna (403).
 */
export const REPORT_ROLES: readonly Role[] = ['ADMIN', 'AUDITOR', 'WAREHOUSE_MANAGER'];

/** Movimientos que suben el saldo de la bodega. */
const INBOUND: readonly MovementType[] = ['ENTRY', 'TRANSFER_IN', 'ADJUSTMENT_IN'];
/** Movimientos que bajan el saldo de la bodega. */
const OUTBOUND: readonly MovementType[] = ['TRANSFER_OUT', 'SHRINKAGE'];

/** Fila del kardex valorizado: un movimiento del libro, con entrada, salida y saldo valorizado. */
export interface KardexRow {
  id: string;
  createdAt: string;
  type: MovementType;
  /** Motivo del movimiento o, si no tiene, el traspaso que lo originó; null si no hay ninguno. */
  reference: string | null;
  transferId: string | null;
  /** Cantidad del movimiento tal como está en el libro. */
  quantity: number;
  quantityIn: number;
  quantityOut: number;
  balanceQty: number;
  unitCost: string;
  balanceAvgCost: string;
  /** Saldo × CPP resultante, con 4 decimales. */
  balanceValue: string;
}

/**
 * Convierte un movimiento en fila del kardex. Sale tal cual del libro: no se recalcula ningún CPP,
 * solo se reparte la cantidad en entrada o salida y se valoriza el saldo. La merma en tránsito no
 * es ni entrada ni salida: la mercancía se perdió en el camino y no estaba en ninguna bodega, así
 * que el saldo no cambia (la cantidad perdida queda en `quantity`).
 */
export function toKardexRow(movement: StockMovement): KardexRow {
  return {
    id: movement.id,
    createdAt: movement.createdAt,
    type: movement.type,
    reference: movement.reason ?? movement.transferId,
    transferId: movement.transferId,
    quantity: movement.quantity,
    quantityIn: INBOUND.includes(movement.type) ? movement.quantity : 0,
    quantityOut: OUTBOUND.includes(movement.type) ? movement.quantity : 0,
    balanceQty: movement.balanceQty,
    unitCost: movement.unitCost,
    balanceAvgCost: movement.balanceAvgCost,
    balanceValue: totalValue({
      quantity: movement.balanceQty,
      avgCost: movement.balanceAvgCost,
    }),
  };
}

export interface ReportWarehouse {
  id: string;
  code: string;
  name: string;
}

export interface ReportProduct {
  id: string;
  sku: string;
  name: string;
  unit: string;
}
