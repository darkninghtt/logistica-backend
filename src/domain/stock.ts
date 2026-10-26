import { Decimal } from 'decimal.js';
import { ConflictError, ValidationError } from './errors';

// Decimal propio: precisión de sobra y redondeo "half up" (el de la contabilidad), sin tocar el global
const Money = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

/** Los costos tienen 4 decimales (NUMERIC(14,4)). */
export const COST_SCALE = 4;
/** Cantidad máxima por entrada y por saldo: así la suma nunca desborda el INTEGER de la BD. */
export const MAX_QUANTITY = 1_000_000_000;
/** Costo máximo que cabe en NUMERIC(14,4): 10 enteros y 4 decimales. */
export const COST_PATTERN = /^\d{1,10}(\.\d{1,4})?$/;

/** Existencias de un producto en una bodega. El costo viaja como string (nunca como float). */
export interface StockBalance {
  quantity: number;
  avgCost: string;
}

export interface StockEntry {
  quantity: number;
  unitCost: string;
}

/**
 * Costo Promedio Ponderado al entrar stock:
 *   nuevo = (cant × costo + cant_in × costo_in) / (cant + cant_in), redondeado a 4 decimales.
 * Con stock cero el costo pasa a ser el de la entrada. Función pura: no toca la BD.
 */
export function applyEntry(current: StockBalance, entry: StockEntry): StockBalance {
  if (!Number.isInteger(entry.quantity) || entry.quantity <= 0) {
    throw new ValidationError('La cantidad de la entrada debe ser un entero mayor que 0');
  }
  if (!COST_PATTERN.test(entry.unitCost) || new Money(entry.unitCost).lte(0)) {
    throw new ValidationError(
      'El costo unitario debe ser mayor que 0, con hasta 4 decimales y máximo 10 enteros',
    );
  }
  const quantity = current.quantity + entry.quantity;
  if (quantity > MAX_QUANTITY) {
    throw new ValidationError(`El saldo no puede superar ${MAX_QUANTITY} unidades`);
  }

  const entryCost = new Money(entry.unitCost);
  if (current.quantity === 0) {
    return { quantity, avgCost: entryCost.toFixed(COST_SCALE) };
  }
  const totalValue = new Money(current.avgCost)
    .times(current.quantity)
    .plus(entryCost.times(entry.quantity));
  return { quantity, avgCost: totalValue.div(quantity).toFixed(COST_SCALE) };
}

/**
 * Merma de bodega: descuenta stock al costo vigente. Una salida no recalcula el CPP, así que
 * el costo promedio queda igual. Función pura: no toca la BD.
 */
export function applyShrinkage(current: StockBalance, quantity: number): StockBalance {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new ValidationError('La cantidad de la merma debe ser un entero mayor que 0');
  }
  if (quantity > current.quantity) {
    throw new ConflictError(
      'No hay stock suficiente en la bodega para registrar la merma',
      'INSUFFICIENT_STOCK',
    );
  }
  return { quantity: current.quantity - quantity, avgCost: current.avgCost };
}

/** Motivos de una merma de bodega. */
export const SHRINKAGE_REASONS = ['DAMAGE', 'EXPIRED', 'THEFT', 'COUNT_ADJUSTMENT'] as const;

export type ShrinkageReason = (typeof SHRINKAGE_REASONS)[number];

/**
 * Texto que queda en la columna `reason` del libro: el código del motivo y, si hay nota,
 * "CÓDIGO: nota". El código siempre va antes del primer ": ".
 */
export function shrinkageReasonText(reason: ShrinkageReason, note?: string): string {
  return note ? `${reason}: ${note}` : reason;
}

/** Valor total del stock (cantidad × costo promedio), como string con 4 decimales. */
export function totalValue(balance: StockBalance): string {
  return new Money(balance.avgCost).times(balance.quantity).toFixed(COST_SCALE);
}

/** Nivel de existencias tal como lo devuelve la API. */
export interface StockLevel {
  productId: string;
  warehouseId: string;
  quantity: number;
  avgCost: string;
  totalValue: string;
}

export const MOVEMENT_TYPES = [
  'ENTRY',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'SHRINKAGE',
  'TRANSIT_SHRINKAGE',
  'ADJUSTMENT_IN',
] as const;

export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Fila del libro de movimientos, con el saldo y el costo promedio resultantes. */
export interface StockMovement {
  id: string;
  productId: string;
  warehouseId: string;
  type: MovementType;
  quantity: number;
  unitCost: string;
  balanceQty: number;
  balanceAvgCost: string;
  /** Motivo (mermas y ajustes); null si el movimiento no lo lleva. */
  reason: string | null;
  /** Traspaso que originó el movimiento; null si no viene de uno. */
  transferId: string | null;
  createdBy: string;
  createdAt: string;
}

/** Movimiento sin campos de costo: lo que recibe el OPERATOR. */
export type StockMovementNoCost = Omit<StockMovement, 'unitCost' | 'balanceAvgCost'>;

/** Nivel sin campos de costo: lo que recibe el OPERATOR. */
export type StockLevelNoCost = Omit<StockLevel, 'avgCost' | 'totalValue'>;

/** Copia explícita de los campos permitidos: un campo de costo nuevo no se filtra por descuido. */
export function movementWithoutCosts(movement: StockMovement): StockMovementNoCost {
  return {
    id: movement.id,
    productId: movement.productId,
    warehouseId: movement.warehouseId,
    type: movement.type,
    quantity: movement.quantity,
    balanceQty: movement.balanceQty,
    reason: movement.reason,
    transferId: movement.transferId,
    createdBy: movement.createdBy,
    createdAt: movement.createdAt,
  };
}

export function levelWithoutCosts(level: StockLevel): StockLevelNoCost {
  return {
    productId: level.productId,
    warehouseId: level.warehouseId,
    quantity: level.quantity,
  };
}
