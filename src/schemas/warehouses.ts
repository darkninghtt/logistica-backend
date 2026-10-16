import { z } from 'zod';

/** Cuerpo de POST y PUT: el PUT reemplaza los tres campos. */
export const warehouseBodySchema = z.object({
  code: z.string().trim().min(1, 'es obligatorio').max(20, 'es demasiado largo'),
  name: z.string().trim().min(1, 'es obligatorio').max(100, 'es demasiado largo'),
  active: z.boolean().default(true),
});

export type WarehouseInput = z.infer<typeof warehouseBodySchema>;

export const idParamSchema = z.object({ id: z.uuid('no es un identificador válido') });

/** Paginación simple por número de página (los valores de la query llegan como texto). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;
