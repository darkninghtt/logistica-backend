import type { Role } from './user';
import { totalValue, type MovementType, type StockMovement } from './stock';
import type { TransferStatus } from './transfer';

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

/**
 * Zona horaria con la que se interpretan los filtros por fecha (`from` y `to`): una merma
 * registrada a las 9 p. m. en Colombia cuenta para ese día, no para el siguiente en UTC.
 */
export const REPORT_TIME_ZONE = 'America/Bogota';

/** Tipos de movimiento que cuentan como merma en el reporte. */
export const SHRINKAGE_TYPES = ['SHRINKAGE', 'TRANSIT_SHRINKAGE'] as const;
export type ShrinkageType = (typeof SHRINKAGE_TYPES)[number];

/**
 * Fila del reporte de mermas: lo perdido de un producto en una bodega, por tipo y motivo. El motivo
 * de una merma de bodega es su código (DAMAGE, EXPIRED...; sin la nota). La merma en tránsito no se
 * agrupa por motivo (es texto libre de cada resolución) y queda en la bodega de destino, que es
 * donde se registró.
 */
export interface ShrinkageReportRow {
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productId: string;
  productSku: string;
  productName: string;
  type: ShrinkageType;
  reason: string | null;
  quantity: number;
  /** Cantidad × costo con que se registró cada merma, sumado. */
  value: string;
}

export interface ShrinkageReport {
  data: ShrinkageReportRow[];
  totals: { quantity: number; value: string };
}

/** Traspaso en tránsito valorizado al costo congelado al despachar. */
export interface InTransitReportRow {
  transferId: string;
  originWarehouseId: string;
  originCode: string;
  originName: string;
  destinationWarehouseId: string;
  destinationCode: string;
  destinationName: string;
  dispatchedAt: string;
  daysInTransit: number;
  quantity: number;
  value: string;
}

export interface InTransitReport {
  data: InTransitReportRow[];
  totals: { transfers: number; quantity: number; value: string };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Días completos transcurridos desde el despacho (0 el mismo día). */
export function daysInTransit(dispatchedAt: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(dispatchedAt).getTime()) / DAY_MS));
}

/** Días hacia atrás que cubre el total de mermas del dashboard. */
export const SUMMARY_SHRINKAGE_DAYS = 30;

/** Valor del inventario de una bodega: suma de cantidad × costo promedio de sus existencias. */
export interface WarehouseInventoryValue {
  warehouseId: string;
  code: string;
  name: string;
  value: string;
}

/** Resumen del dashboard (GET /api/reports/summary), ya filtrado por las bodegas de quien lo pide. */
export interface DashboardSummary {
  inventoryValueByWarehouse: WarehouseInventoryValue[];
  transfersByStatus: Record<TransferStatus, number>;
  shrinkageLast30Days: { quantity: number; value: string };
  /** Valor de la mercancía en tránsito al costo congelado al despachar. */
  inTransitValue: string;
}

/** Cuenta por estado con todos los estados presentes (0 los que no tienen traspasos). */
export function countByStatus(
  rows: readonly { status: TransferStatus; count: number }[],
): Record<TransferStatus, number> {
  const counts: Record<TransferStatus, number> = {
    DRAFT: 0,
    IN_TRANSIT: 0,
    RECEIVED: 0,
    DISCREPANCY: 0,
    RESOLVED: 0,
    CANCELLED: 0,
  };
  for (const row of rows) counts[row.status] = row.count;
  return counts;
}

/** Inicio de la ventana de mermas del dashboard: `SUMMARY_SHRINKAGE_DAYS` días antes de `now`. */
export function shrinkageWindowStart(now: Date): Date {
  return new Date(now.getTime() - SUMMARY_SHRINKAGE_DAYS * DAY_MS);
}
