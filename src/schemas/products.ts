import { z } from 'zod';

/** Cuerpo de POST y PUT: el PUT reemplaza los tres campos. */
export const productBodySchema = z.object({
  sku: z.string().trim().min(1, 'es obligatorio').max(40, 'es demasiado largo'),
  name: z.string().trim().min(1, 'es obligatorio').max(100, 'es demasiado largo'),
  unit: z.string().trim().min(1, 'es obligatoria').max(20, 'es demasiado larga'),
});

export type ProductInput = z.infer<typeof productBodySchema>;
