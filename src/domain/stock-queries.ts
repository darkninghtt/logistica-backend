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
