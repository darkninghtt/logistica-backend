import { z } from 'zod';
import { MAX_QUANTITY } from '../domain/stock';
import { TRANSFER_STATUSES } from '../domain/transfer';
import { decimalSchema, idSchema, pageOf, timestampSchema } from './common';
import { pageQuerySchema } from './page';
import { warehouseRefSchema } from './warehouses';

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

const statusSchema = z.enum(TRANSFER_STATUSES);

/** Traspaso en el listado. */
export const transferSummarySchema = z.strictObject({
  id: idSchema,
  status: statusSchema,
  origin: warehouseRefSchema,
  destination: warehouseRefSchema,
  itemCount: z.int(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const transferPageSchema = pageOf(transferSummarySchema);

/** Ítem del detalle de un traspaso. */
export const transferItemSchema = z.strictObject({
  productId: idSchema,
  productSku: z.string().meta({ example: 'SKU-001' }),
  productName: z.string().meta({ example: 'Tornillo 1/4' }),
  quantitySent: z.int(),
  quantityReceived: z.int().nullable().meta({ description: 'null hasta que se recibe' }),
  unitCost: decimalSchema.nullable().optional().meta({
    description: 'Costo congelado al despachar (null en borrador). No se envía al OPERATOR.',
  }),
});

/** Línea de la auditoría de un traspaso (transfer_events). */
export const transferEventSchema = z.strictObject({
  fromStatus: statusSchema.nullable(),
  toStatus: statusSchema,
  actor: z.strictObject({ id: idSchema, name: z.string() }),
  reason: z.string().nullable(),
  createdAt: timestampSchema,
});

/** Detalle de un traspaso: lo devuelven el detalle y todas las transiciones. */
export const transferDetailSchema = z.strictObject({
  id: idSchema,
  status: statusSchema,
  origin: warehouseRefSchema,
  destination: warehouseRefSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  note: z.string().nullable(),
  createdBy: idSchema,
  dispatchedBy: idSchema.nullable(),
  dispatchedAt: timestampSchema.nullable(),
  receivedBy: idSchema.nullable(),
  receivedAt: timestampSchema.nullable(),
  resolvedBy: idSchema.nullable(),
  resolvedAt: timestampSchema.nullable(),
  items: z.array(transferItemSchema),
  events: z.array(transferEventSchema),
});
