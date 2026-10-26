import { z } from 'zod';
import { COST_PATTERN, MAX_QUANTITY, SHRINKAGE_REASONS } from '../domain/stock';

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

/** Cuerpo de POST /api/stock/shrinkage. */
export const stockShrinkageBodySchema = z.object({
  warehouseId: z.uuid('no es un identificador válido'),
  productId: z.uuid('no es un identificador válido'),
  quantity: z.number().int('debe ser un entero').min(1, 'debe ser mayor que 0').max(MAX_QUANTITY),
  reason: z.enum(SHRINKAGE_REASONS, 'debe ser DAMAGE, EXPIRED, THEFT o COUNT_ADJUSTMENT'),
  note: z.string().trim().max(500, 'máximo 500 caracteres').optional(),
});

export type StockShrinkageInput = z.infer<typeof stockShrinkageBodySchema>;
