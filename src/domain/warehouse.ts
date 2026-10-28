export interface Warehouse {
  id: string;
  code: string;
  name: string;
  active: boolean;
  createdAt: string;
}

/** Lo mínimo de una bodega para elegirla en un selector. */
export type WarehouseOption = Pick<Warehouse, 'id' | 'code' | 'name'>;
