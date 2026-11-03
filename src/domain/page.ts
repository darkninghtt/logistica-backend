/** Página de resultados con el formato de lista de la API: `{ data, page, pageSize, total }`. */
export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** Página por cursor (keyset): `nextCursor` es null cuando ya no hay más filas. */
export interface CursorPage<T> {
  data: T[];
  nextCursor: string | null;
}

/** El cursor es el id de la última fila entregada, en base64url: para el cliente es opaco. */
export function encodeCursor(id: string): string {
  return Buffer.from(id, 'utf8').toString('base64url');
}

/**
 * Arma la página a partir de `limit + 1` filas: si llegó la fila de más, hay otra página y el
 * cursor apunta a la última que sí se entrega. Así no hace falta contar el total.
 */
export function toCursorPage<T extends { id: string }>(rows: T[], limit: number): CursorPage<T> {
  const data = rows.slice(0, limit);
  const last = data.at(-1);
  return { data, nextCursor: rows.length > limit && last ? encodeCursor(last.id) : null };
}
