import { z } from 'zod';
import { idSchema, pageOf, timestampSchema } from './common';

/** Cuerpo de POST y PUT: el PUT reemplaza los tres campos. */
export const warehouseBodySchema = z.object({
  code: z.string().trim().min(1, 'es obligatorio').max(20, 'es demasiado largo'),
  name: z.string().trim().min(1, 'es obligatorio').max(100, 'es demasiado largo'),
  active: z.boolean().default(true),
});

export type WarehouseInput = z.infer<typeof warehouseBodySchema>;

/** Bodega tal como la devuelve la API. */
export const warehouseSchema = z.strictObject({
  id: idSchema,
  code: z.string().meta({ example: 'BOD-A' }),
  name: z.string().meta({ example: 'Bodega A' }),
  active: z.boolean(),
  createdAt: timestampSchema,
});

export const warehousePageSchema = pageOf(warehouseSchema);

/** Referencia corta a una bodega (traspasos, destinos y reportes). */
export const warehouseRefSchema = z.strictObject({
  id: idSchema,
  code: z.string().meta({ example: 'BOD-A' }),
  name: z.string().meta({ example: 'Bodega A' }),
});

/** GET /api/warehouses/destinations: todas las bodegas activas. */
export const warehouseDestinationListSchema = z.strictObject({ data: z.array(warehouseRefSchema) });
