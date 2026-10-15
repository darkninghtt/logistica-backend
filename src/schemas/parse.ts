import { z } from 'zod';
import { ValidationError } from '../domain/errors';

// Mensajes de validación de Zod en español
z.config(z.locales.es());

/** Valida `data` con el esquema; si es inválido lanza un ValidationError con un mensaje claro. */
export function parseWith<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) =>
        issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
      )
      .join('; ');
    throw new ValidationError(problems);
  }
  return result.data;
}
