import { z } from 'zod';
import { cursorQuerySchema } from './page';

/** Query de GET /api/reports/kardex: bodega y producto obligatorios, paginado por cursor. */
export const kardexQuerySchema = cursorQuerySchema.extend({
  warehouseId: z.uuid('no es un identificador válido'),
  productId: z.uuid('no es un identificador válido'),
});

export type KardexQuery = z.infer<typeof kardexQuerySchema>;
