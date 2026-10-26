import { z } from 'zod';
import { MAX_QUANTITY } from '../domain/stock';
import { TRANSFER_STATUSES } from '../domain/transfer';
import { pageQuerySchema } from './page';

const uuid = z.uuid('no es un identificador válido');
const quantity = z
  .number()
  .int('debe ser un entero')
  .min(1, 'debe ser mayor que 0')
  .max(MAX_QUANTITY);
const text = (max: number) => z.string().trim().max(max, `máximo ${max} caracteres`);

/** Los productos no se pueden repetir dentro de un mismo traspaso. */
function noRepeatedProducts(items: readonly { productId: string }[]): boolean {
  return new Set(items.map((item) => item.productId)).size === items.length;
}

/** Cuerpo de POST /api/transfers. */
export const createTransferBodySchema = z
  .object({
    originWarehouseId: uuid,
    destinationWarehouseId: uuid,
    items: z
      .array(z.object({ productId: uuid, quantity }))
      .min(1, 'debe tener al menos un producto')
      .max(100, 'máximo 100 productos')
      .refine(noRepeatedProducts, 'hay productos repetidos'),
    note: text(500).optional(),
  })
  .refine((body) => body.originWarehouseId !== body.destinationWarehouseId, {
    message: 'el origen y el destino deben ser distintos',
    path: ['destinationWarehouseId'],
  });

/** Query de GET /api/transfers. */
export const listTransfersQuerySchema = pageQuerySchema.extend({
  status: z.enum(TRANSFER_STATUSES).optional(),
  warehouseId: uuid.optional(),
});

/** Cuerpo de POST /api/transfers/:id/cancel. */
export const cancelTransferBodySchema = z.object({ reason: text(500).optional() });

/** Cuerpo de POST /api/transfers/:id/receive: la cantidad recibida de todos los ítems. */
export const receiveTransferBodySchema = z.object({
  items: z
    .array(
      z.object({
        productId: uuid,
        receivedQuantity: z
          .number()
          .int('debe ser un entero')
          .min(0, 'no puede ser negativa')
          .max(MAX_QUANTITY),
      }),
    )
    .min(1, 'debe declarar al menos un producto')
    .refine(noRepeatedProducts, 'hay productos repetidos'),
});

/** Cuerpo de POST /api/transfers/:id/resolve: el motivo es obligatorio. */
export const resolveTransferBodySchema = z.object({
  reason: text(500).min(1, 'el motivo es obligatorio'),
});

export const SHRINKAGE_REASONS = ['DAMAGE', 'EXPIRED', 'THEFT', 'COUNT_ADJUSTMENT'] as const;

/** Cuerpo de POST /api/stock/shrinkage. */
export const shrinkageBodySchema = z.object({
  warehouseId: uuid,
  productId: uuid,
  quantity,
  reason: z.enum(SHRINKAGE_REASONS),
  note: text(500).optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferBodySchema>;
export type ListTransfersQuery = z.infer<typeof listTransfersQuerySchema>;
export type CancelTransferInput = z.infer<typeof cancelTransferBodySchema>;
export type ReceiveTransferInput = z.infer<typeof receiveTransferBodySchema>;
export type ResolveTransferInput = z.infer<typeof resolveTransferBodySchema>;
export type ShrinkageInput = z.infer<typeof shrinkageBodySchema>;
