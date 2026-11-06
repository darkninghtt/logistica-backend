import { z } from 'zod';
import { idSchema, pageOf, timestampSchema } from './common';

/** Cuerpo de POST y PUT: el PUT reemplaza los tres campos. */
export const productBodySchema = z.object({
  sku: z.string().trim().min(1, 'es obligatorio').max(40, 'es demasiado largo'),
  name: z.string().trim().min(1, 'es obligatorio').max(100, 'es demasiado largo'),
  unit: z.string().trim().min(1, 'es obligatoria').max(20, 'es demasiado larga'),
});

export type ProductInput = z.infer<typeof productBodySchema>;

/** Producto tal como lo devuelve la API. */
export const productSchema = z.strictObject({
  id: idSchema,
  sku: z.string().meta({ example: 'SKU-001' }),
  name: z.string().meta({ example: 'Tornillo 1/4' }),
  unit: z.string().meta({ example: 'un' }),
  createdAt: timestampSchema,
});

export const productPageSchema = pageOf(productSchema);
