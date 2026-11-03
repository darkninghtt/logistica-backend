import { z } from 'zod';

/** Paginación simple por número de página (los valores de la query llegan como texto). */
export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PageQuery = z.infer<typeof pageQuerySchema>;

/** Id de un movimiento dentro del cursor: entero positivo que cabe en BIGINT. */
const CURSOR_ID = /^[1-9]\d{0,17}$/;

/**
 * Paginación por cursor: `limit` y, desde la segunda página, el `cursor` que devolvió la anterior.
 * El cursor se decodifica aquí: lo que llega al servicio es el id del último movimiento visto.
 */
export const cursorQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z
    .string()
    .transform((value, ctx) => {
      const id = Buffer.from(value, 'base64url').toString('utf8');
      // Volver a codificarlo descarta los caracteres que el decodificador ignora en silencio
      if (!CURSOR_ID.test(id) || Buffer.from(id, 'utf8').toString('base64url') !== value) {
        ctx.addIssue({ code: 'custom', message: 'no es un cursor válido' });
        return z.NEVER;
      }
      return id;
    })
    .optional(),
});

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

/** Parámetro `:id` de la ruta. */
export const idParamSchema = z.object({ id: z.uuid('no es un identificador válido') });
