export interface Warehouse {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/** Página de resultados con el formato de lista de la API: `{ data, page, pageSize, total }`. */
export interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}
