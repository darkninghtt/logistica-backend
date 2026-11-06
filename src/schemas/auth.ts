import { z } from 'zod';
import { idSchema, timestampSchema } from './common';
import { passwordSchema, publicUserSchema } from './users';

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

/** Respuesta del login y del refresh. El refresh token va aparte, en la cookie HttpOnly. */
export const loginResponseSchema = z.strictObject({
  accessToken: z.string().meta({ description: 'JWT de corta duración' }),
  user: publicUserSchema,
});

/** Sesión activa: una familia de refresh tokens del usuario. */
export const sessionSchema = z.strictObject({
  id: idSchema.meta({ description: 'Familia de refresh tokens' }),
  userAgent: z.string().nullable(),
  createdAt: timestampSchema,
  lastUsedAt: timestampSchema.nullable(),
  current: z.boolean().meta({ description: 'Es la sesión de esta cookie' }),
});

export const sessionListSchema = z.array(sessionSchema);
