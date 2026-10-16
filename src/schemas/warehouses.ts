import { z } from 'zod';

/** Cuerpo de POST y PUT: el PUT reemplaza los tres campos. */
export const warehouseBodySchema = z.object({
  code: z.string().trim().min(1, 'es obligatorio').max(20, 'es demasiado largo'),
  name: z.string().trim().min(1, 'es obligatorio').max(100, 'es demasiado largo'),
  active: z.boolean().default(true),
});

export type WarehouseInput = z.infer<typeof warehouseBodySchema>;
