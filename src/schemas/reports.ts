import { z } from 'zod';
import { SHRINKAGE_TYPES } from '../domain/reports';
import { MOVEMENT_TYPES } from '../domain/stock';
import { countSchema, decimalSchema, idSchema, nextCursorSchema, timestampSchema } from './common';
import { cursorQuerySchema } from './page';

const uuid = z.uuid('no es un identificador válido');

/** Query de GET /api/reports/kardex: bodega y producto obligatorios, paginado por cursor. */
export const kardexQuerySchema = cursorQuerySchema.extend({
  warehouseId: uuid,
  productId: uuid,
});

/** Formato de la exportación. */
export const exportFormatSchema = z.enum(['csv', 'pdf'], 'debe ser csv o pdf');

/** Query de GET /api/reports/kardex/export: igual que el kardex, sin cursor (exporta todo). */
export const kardexExportQuerySchema = z.object({
  warehouseId: uuid,
  productId: uuid,
  format: exportFormatSchema,
});

/** Fecha de calendario `YYYY-MM-DD` (se interpreta en la zona horaria de los reportes). */
const day = z.iso.date('debe ser una fecha AAAA-MM-DD');

const shrinkageFilters = z.object({
  /** Sin bodega: todas las visibles para quien consulta. */
  warehouseId: uuid.optional(),
  from: day.optional(),
  to: day.optional(),
});

/** Las fechas `AAAA-MM-DD` se comparan bien como texto. */
function fromNotAfterTo(query: { from?: string; to?: string }): boolean {
  return !query.from || !query.to || query.from <= query.to;
}
const RANGE_ERROR = {
  message: 'la fecha inicial no puede ser posterior a la final',
  path: ['from'],
};

/** Query de GET /api/reports/shrinkage: bodega opcional y rango de fechas opcional (inclusivo). */
export const shrinkageReportQuerySchema = shrinkageFilters.refine(fromNotAfterTo, RANGE_ERROR);

/** Query de GET /api/reports/shrinkage/export: los mismos filtros más el formato. */
export const shrinkageExportQuerySchema = shrinkageFilters
  .extend({ format: exportFormatSchema })
  .refine(fromNotAfterTo, RANGE_ERROR);

/** Query de GET /api/reports/in-transit: bodega opcional (como origen o destino). */
export const inTransitQuerySchema = z.object({ warehouseId: uuid.optional() });

export type KardexQuery = z.infer<typeof kardexQuerySchema>;
export type KardexExportQuery = z.infer<typeof kardexExportQuerySchema>;
export type ExportFormat = z.infer<typeof exportFormatSchema>;
export type ShrinkageReportQuery = z.infer<typeof shrinkageReportQuerySchema>;
export type ShrinkageExportQuery = z.infer<typeof shrinkageExportQuerySchema>;
export type InTransitQuery = z.infer<typeof inTransitQuerySchema>;

/** Fila del kardex valorizado. */
export const kardexRowSchema = z.strictObject({
  id: z.string().meta({ description: 'Id del movimiento en el libro' }),
  createdAt: timestampSchema,
  type: z.enum(MOVEMENT_TYPES),
  reference: z
    .string()
    .nullable()
    .meta({ description: 'Motivo del movimiento o, si no tiene, el id del traspaso' }),
  transferId: idSchema.nullable(),
  quantity: z.int().meta({ description: 'Cantidad del movimiento en el libro' }),
  quantityIn: z.int(),
  quantityOut: z.int(),
  balanceQty: z.int(),
  unitCost: decimalSchema,
  balanceAvgCost: decimalSchema,
  balanceValue: decimalSchema,
});

export const kardexPageSchema = z.strictObject({
  data: z.array(kardexRowSchema),
  nextCursor: nextCursorSchema,
  warehouse: z.strictObject({ id: idSchema, code: z.string(), name: z.string() }),
  product: z.strictObject({ id: idSchema, sku: z.string(), name: z.string(), unit: z.string() }),
});

/** GET /api/reports/shrinkage. */
export const shrinkageReportSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      warehouseId: idSchema,
      warehouseCode: z.string(),
      warehouseName: z.string(),
      productId: idSchema,
      productSku: z.string(),
      productName: z.string(),
      type: z.enum(SHRINKAGE_TYPES),
      reason: z
        .string()
        .nullable()
        .meta({ description: 'Código del motivo (null en la merma en tránsito)' }),
      quantity: z.int(),
      value: decimalSchema,
    }),
  ),
  totals: z.strictObject({ quantity: z.int(), value: decimalSchema }),
});

/** GET /api/reports/in-transit. Los valores van al costo congelado al despachar. */
export const inTransitReportSchema = z.strictObject({
  data: z.array(
    z.strictObject({
      transferId: idSchema,
      originWarehouseId: idSchema,
      originCode: z.string(),
      originName: z.string(),
      destinationWarehouseId: idSchema,
      destinationCode: z.string(),
      destinationName: z.string(),
      dispatchedAt: timestampSchema,
      daysInTransit: z.int(),
      quantity: z.int(),
      value: decimalSchema,
    }),
  ),
  totals: z.strictObject({ transfers: z.int(), quantity: z.int(), value: decimalSchema }),
});

/** GET /api/reports/summary: todos los estados presentes, en 0 si no hay traspasos. */
export const dashboardSummarySchema = z.strictObject({
  inventoryValueByWarehouse: z.array(
    z.strictObject({
      warehouseId: idSchema,
      code: z.string(),
      name: z.string(),
      value: decimalSchema,
    }),
  ),
  transfersByStatus: z.strictObject({
    DRAFT: countSchema,
    IN_TRANSIT: countSchema,
    RECEIVED: countSchema,
    DISCREPANCY: countSchema,
    RESOLVED: countSchema,
    CANCELLED: countSchema,
  }),
  shrinkageLast30Days: z.strictObject({ quantity: z.int(), value: decimalSchema }),
  inTransitValue: decimalSchema,
});
