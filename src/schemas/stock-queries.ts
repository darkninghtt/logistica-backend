import { z } from 'zod';
import { pageQuerySchema } from './page';

/** Query de GET /api/stock: la bodega es obligatoria. */
export const stockLevelsQuerySchema = pageQuerySchema.extend({
  warehouseId: z.uuid('no es un identificador válido'),
});

/** Query de GET /api/stock/movements: la bodega es obligatoria y el producto es un filtro opcional. */
export const stockMovementsQuerySchema = stockLevelsQuerySchema.extend({
  productId: z.uuid('no es un identificador válido').optional(),
});

export type StockLevelsQuery = z.infer<typeof stockLevelsQuerySchema>;
export type StockMovementsQuery = z.infer<typeof stockMovementsQuerySchema>;
