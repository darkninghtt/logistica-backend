import { z } from 'zod';
import { COST_PATTERN, MAX_QUANTITY } from '../domain/stock';

/** Cuerpo de POST /api/stock/entries. El costo viaja como string para no perder decimales. */
export const stockEntryBodySchema = z.object({
  warehouseId: z.uuid('no es un identificador válido'),
  productId: z.uuid('no es un identificador válido'),
  quantity: z.number().int('debe ser un entero').min(1, 'debe ser mayor que 0').max(MAX_QUANTITY),
  unitCost: z
    .string('debe enviarse como texto, por ejemplo "100.50"')
    .regex(COST_PATTERN, 'debe ser un número con hasta 4 decimales')
    .refine((value) => Number(value) > 0, 'debe ser mayor que 0'),
});

export type StockEntryInput = z.infer<typeof stockEntryBodySchema>;
