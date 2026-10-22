import { z } from 'zod';
import { roleSchema } from '../domain/user';

const email = z.string().trim().toLowerCase().pipe(z.email('no es un correo válido'));
const name = z.string().trim().min(1, 'es obligatorio').max(100, 'es demasiado largo');
// Mismo mínimo que exige el seed del ADMIN
const password = z
  .string()
  .min(12, 'debe tener al menos 12 caracteres')
  .max(128, 'es demasiado larga');

/** Cuerpo de POST /api/users. */
export const createUserBodySchema = z.object({
  email,
  name,
  role: roleSchema,
  password,
  active: z.boolean().default(true),
});

/** Cuerpo de PUT /api/users/:id: reemplaza los datos; la contraseña solo cambia si se envía. */
export const updateUserBodySchema = z.object({
  email,
  name,
  role: roleSchema,
  password: password.optional(),
  active: z.boolean(),
});

/** Cuerpo de PUT /api/users/:id/warehouses: la lista reemplaza a la anterior. */
export const userWarehousesBodySchema = z.object({
  warehouseIds: z
    .array(z.uuid('no es un identificador válido'))
    .max(200, 'son demasiadas bodegas')
    .transform((ids) => [...new Set(ids)]),
});

export type CreateUserInput = z.infer<typeof createUserBodySchema>;
export type UpdateUserInput = z.infer<typeof updateUserBodySchema>;
