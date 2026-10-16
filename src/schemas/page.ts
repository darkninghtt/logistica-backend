import { z } from 'zod';

/** Paginación simple por número de página (los valores de la query llegan como texto). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Parámetro `:id` de la ruta. */
export const idParamSchema = z.object({ id: z.uuid('no es un identificador válido') });
