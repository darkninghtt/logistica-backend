import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '../../src/domain/errors';
import type { Product } from '../../src/domain/product';
import { createProductsService, type ProductStore } from '../../src/services/products';

const product: Product = {
  id: 'p-1',
  sku: 'SKU-1',
  name: 'Tornillo',
  unit: 'un',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function fakeStore(overrides: Partial<ProductStore> = {}): ProductStore {
  return {
    list: vi.fn(async () => ({ rows: [product], total: 41 })),
    insert: vi.fn(async () => product),
    update: vi.fn(async () => product),
    ...overrides,
  };
}

describe('ProductsService', () => {
  it('list calcula el desplazamiento a partir de la página y devuelve el formato de lista', async () => {
    const store = fakeStore();
    const result = await createProductsService({ products: store }).list({ page: 3, pageSize: 20 });

    expect(store.list).toHaveBeenCalledWith(20, 40);
    expect(result).toEqual({ data: [product], page: 3, pageSize: 20, total: 41 });
  });

  it('create delega en el almacén y devuelve el producto creado', async () => {
    const store = fakeStore();
    const input = { sku: 'SKU-1', name: 'Tornillo', unit: 'un' };

    expect(await createProductsService({ products: store }).create(input)).toEqual(product);
    expect(store.insert).toHaveBeenCalledWith(input);
  });

  it('update devuelve el producto editado', async () => {
    const store = fakeStore();
    const input = { sku: 'SKU-1', name: 'Nuevo nombre', unit: 'kg' };

    await createProductsService({ products: store }).update('p-1', input);
    expect(store.update).toHaveBeenCalledWith('p-1', input);
  });

  it('update lanza NotFoundError si el producto no existe', async () => {
    const store = fakeStore({ update: vi.fn(async () => null) });
    const service = createProductsService({ products: store });

    await expect(
      service.update('no-existe', { sku: 'A', name: 'A', unit: 'un' }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
