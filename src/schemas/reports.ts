import { z } from 'zod';
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
