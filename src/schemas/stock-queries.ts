import { z } from 'zod';
import { MOVEMENT_TYPES } from '../domain/stock';
import { cursorQuerySchema, pageQuerySchema } from './page';

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
