import { z } from 'zod';
import { ERROR_CODES } from '../domain/errors';

/*
 * Piezas comunes de los esquemas de respuesta. Las respuestas usan `z.strictObject`: un campo que
 * la API devuelva y que no esté en el esquema hace fallar la prueba de contrato.
 */

export const idSchema = z.uuid();

/** Fecha y hora ISO 8601 en UTC, como la escribe `Date.toISOString()`. */
export const timestampSchema = z.iso.datetime();

/** Número decimal como texto (costos y valores): nunca viaja como `number` para no perder precisión. */
export const decimalSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/)
  .meta({ description: 'Número decimal como texto', example: '110.0000' });

export const countSchema = z.int().min(0);

type PageShape<T extends z.ZodType> = {
  data: z.ZodArray<T>;
  page: z.ZodInt;
  pageSize: z.ZodInt;
  total: z.ZodInt;
};

/** Lista paginada por número de página: `{ data, page, pageSize, total }`. */
export function pageOf<T extends z.ZodType>(item: T): z.ZodObject<PageShape<T>, z.core.$strict> {
  return z.strictObject({ data: z.array(item), page: z.int(), pageSize: z.int(), total: z.int() });
}

/** Siguiente cursor de una lista paginada por cursor; null cuando ya no hay más. */
export const nextCursorSchema = z
  .string()
  .nullable()
  .meta({ description: 'Se envía como `cursor` para pedir la página siguiente; null al final' });

/** Formato uniforme de error de toda la API. */
export const errorResponseSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string(),
  correlationId: z.string(),
});
