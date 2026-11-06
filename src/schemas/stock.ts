import { z } from 'zod';
import { COST_PATTERN, MAX_QUANTITY, MOVEMENT_TYPES, SHRINKAGE_REASONS } from '../domain/stock';
import { decimalSchema, idSchema, timestampSchema } from './common';

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

const NO_COST_FOR_OPERATOR = 'No se envía al OPERATOR';

/** Existencias de un producto en una bodega. Sin costos para el OPERATOR. */
export const stockLevelSchema = z.strictObject({
  productId: idSchema,
  warehouseId: idSchema,
  quantity: z.int().meta({ example: 20 }),
  avgCost: decimalSchema
    .optional()
    .meta({ description: `Costo promedio ponderado. ${NO_COST_FOR_OPERATOR}` }),
  totalValue: decimalSchema
    .optional()
    .meta({ description: `quantity × avgCost. ${NO_COST_FOR_OPERATOR}` }),
});

/** Movimiento del libro. Sin costos para el OPERATOR. */
export const stockMovementSchema = z.strictObject({
  id: z.string().meta({ example: '1' }),
  productId: idSchema,
  warehouseId: idSchema,
  type: z.enum(MOVEMENT_TYPES),
  quantity: z.int().meta({ example: 10 }),
  unitCost: decimalSchema.optional().meta({ description: NO_COST_FOR_OPERATOR }),
  balanceQty: z.int().meta({ description: 'Saldo después del movimiento' }),
  balanceAvgCost: decimalSchema
    .optional()
    .meta({ description: `Costo promedio después del movimiento. ${NO_COST_FOR_OPERATOR}` }),
  reason: z.string().nullable().meta({ description: 'Motivo (mermas, ajustes y resoluciones)' }),
  transferId: idSchema.nullable().meta({ description: 'Traspaso que originó el movimiento' }),
  createdBy: idSchema,
  createdAt: timestampSchema,
});

/** Respuesta de una entrada o de una merma: el movimiento y el saldo que dejó. */
export const stockEntryResponseSchema = z.strictObject({
  movement: stockMovementSchema,
  stockLevel: stockLevelSchema,
});
