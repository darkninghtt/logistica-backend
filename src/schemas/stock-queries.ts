import { z } from 'zod';
import { MOVEMENT_TYPES } from '../domain/stock';
import { nextCursorSchema, pageOf } from './common';
import { cursorQuerySchema, pageQuerySchema } from './page';
import { stockLevelSchema, stockMovementSchema } from './stock';

/** Query de GET /api/stock: la bodega es obligatoria. */
export const stockLevelsQuerySchema = pageQuerySchema.extend({
  warehouseId: z.uuid('no es un identificador válido'),
});

/**
 * Query de GET /api/stock/movements: la bodega es obligatoria; el producto y el tipo son filtros
 * opcionales. Se pagina por cursor (`limit` y `cursor`), no por número de página.
 */
export const stockMovementsQuerySchema = cursorQuerySchema.extend({
  warehouseId: z.uuid('no es un identificador válido'),
  productId: z.uuid('no es un identificador válido').optional(),
  type: z.enum(MOVEMENT_TYPES).optional(),
});

export type StockLevelsQuery = z.infer<typeof stockLevelsQuerySchema>;
export type StockMovementsQuery = z.infer<typeof stockMovementsQuerySchema>;

/** Existencias con los datos del producto (GET /api/stock). */
export const stockLevelItemSchema = stockLevelSchema.extend({
  productSku: z.string().meta({ example: 'SKU-001' }),
  productName: z.string().meta({ example: 'Tornillo 1/4' }),
  productUnit: z.string().meta({ example: 'un' }),
});

export const stockLevelPageSchema = pageOf(stockLevelItemSchema);

/** Movimiento con los datos del producto (GET /api/stock/movements). */
export const stockMovementItemSchema = stockMovementSchema.extend({
  productSku: z.string().meta({ example: 'SKU-001' }),
  productName: z.string().meta({ example: 'Tornillo 1/4' }),
});

export const stockMovementPageSchema = z.strictObject({
  data: z.array(stockMovementItemSchema),
  nextCursor: nextCursorSchema,
});
