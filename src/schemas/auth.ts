import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'es obligatorio').email('no es un correo válido').toLowerCase(),
  password: z.string().min(1, 'es obligatoria').max(256, 'es demasiado larga'),
});

export type LoginInput = z.infer<typeof loginSchema>;
