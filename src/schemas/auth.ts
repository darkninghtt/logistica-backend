import { z } from 'zod';
import { passwordSchema } from './users';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'es obligatorio').email('no es un correo válido').toLowerCase(),
  password: z.string().min(1, 'es obligatoria').max(256, 'es demasiado larga'),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** Cuerpo de PUT /api/auth/password. La nueva sigue las mismas reglas que al crear un usuario. */
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'es obligatoria').max(256, 'es demasiado larga'),
  newPassword: passwordSchema,
});
