import { assertRole, type Actor } from '../domain/authorization';
import { NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import type { Product } from '../domain/product';
import type { PageQuery } from '../schemas/page';
import type { ProductInput } from '../schemas/products';

/** Lo que el servicio necesita de la persistencia (la implementa el repositorio). */
export interface ProductStore {
  /** Una página de productos ordenados por SKU, y el total de productos. */
  list(limit: number, offset: number): Promise<{ rows: Product[]; total: number }>;
  insert(input: ProductInput): Promise<Product>;
  /** Reemplaza sku, name y unit. Devuelve null si el id no existe. */
  update(id: string, input: ProductInput): Promise<Product | null>;
}

export interface ProductsService {
  list(query: PageQuery): Promise<Page<Product>>;
  /** Solo el ADMIN. */
  create(input: ProductInput, actor: Actor): Promise<Product>;
  /** Solo el ADMIN. */
  update(id: string, input: ProductInput, actor: Actor): Promise<Product>;
}

export function createProductsService({ products }: { products: ProductStore }): ProductsService {
  return {
    async list({ page, pageSize }) {
      const { rows, total } = await products.list(pageSize, (page - 1) * pageSize);
      return { data: rows, page, pageSize, total };
    },

    async create(input, actor) {
      assertRole(actor, ['ADMIN']);
      return products.insert(input);
    },

    async update(id, input, actor) {
      assertRole(actor, ['ADMIN']);
      const updated = await products.update(id, input);
      if (!updated) {
        throw new NotFoundError('El producto no existe');
      }
      return updated;
    },
  };
}
