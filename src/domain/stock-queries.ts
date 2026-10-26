import type { StockLevel, StockMovement } from './stock';

/** Nivel de stock con los datos del producto, listo para mostrarse en una tabla. */
export interface StockLevelItem extends StockLevel {
  productSku: string;
  productName: string;
  productUnit: string;
}

/** Movimiento del libro con los datos del producto. */
export interface StockMovementItem extends StockMovement {
  productSku: string;
  productName: string;
}

/** Nivel sin campos de costo: lo que recibe el OPERATOR. */
export type StockLevelItemNoCost = Omit<StockLevelItem, 'avgCost' | 'totalValue'>;

/** Movimiento sin campos de costo: lo que recibe el OPERATOR. */
export type StockMovementItemNoCost = Omit<StockMovementItem, 'unitCost' | 'balanceAvgCost'>;

/** Copia explícita de los campos permitidos: un campo de costo nuevo no se filtra por descuido. */
export function withoutLevelCosts(level: StockLevelItem): StockLevelItemNoCost {
  return {
    productId: level.productId,
    warehouseId: level.warehouseId,
    quantity: level.quantity,
    productSku: level.productSku,
    productName: level.productName,
    productUnit: level.productUnit,
  };
}

export function withoutMovementCosts(movement: StockMovementItem): StockMovementItemNoCost {
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
    productSku: movement.productSku,
    productName: movement.productName,
  };
}
