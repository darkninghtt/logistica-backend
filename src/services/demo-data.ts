import type { Actor } from '../domain/authorization';
import type { SeedWarehouse } from './seed';
import type { StockService } from './stock';
import type { TransfersService } from './transfers';

/*
 * Datos de demo realistas (`npm run seed:demo`). Todo pasa por los servicios de stock y de
 * traspasos, igual que si se hiciera desde la aplicación: así el CPP se calcula con las mismas
 * reglas, cada movimiento queda en el libro y el libro cuadra con stock_levels.
 */

export interface DemoProduct {
  sku: string;
  name: string;
  unit: string;
}

/** Catálogo de la demo y la marca de que ya se sembró (solo SQL, en el repositorio). */
export interface DemoCatalogStore {
  /** Crea la bodega si no existe (por código) y devuelve su id. */
  ensureWarehouse(warehouse: SeedWarehouse): Promise<string>;
  /** Crea el producto si no existe (por SKU) y devuelve su id. */
  ensureProduct(product: DemoProduct): Promise<string>;
  /** true si alguno de estos productos ya tiene movimientos: la demo ya se sembró. */
  hasMovements(skus: string[]): Promise<boolean>;
}

export interface DemoDataDeps {
  catalog: DemoCatalogStore;
  stock: Pick<StockService, 'registerEntry' | 'registerShrinkage'>;
  transfers: Pick<TransfersService, 'create' | 'dispatch' | 'receive' | 'resolve' | 'cancel'>;
  findUserId(email: string): Promise<string | null>;
  addWarehouses(userId: string, warehouseIds: string[]): Promise<void>;
}

export interface DemoDataService {
  /** Siembra la demo; devuelve false si ya estaba (no repite nada). */
  run(users: { adminEmail: string; managerEmail: string }): Promise<boolean>;
}

export const DEMO_DATA_WAREHOUSES: SeedWarehouse[] = [
  { code: 'BOD-A', name: 'Bodega A' },
  { code: 'BOD-B', name: 'Bodega B' },
  { code: 'BOD-C', name: 'Bodega C' },
];

export const DEMO_PRODUCTS: DemoProduct[] = [
  { sku: 'TOR-014', name: 'Tornillo hexagonal 1/4"', unit: 'un' },
  { sku: 'CEM-050', name: 'Cemento gris 50 kg', unit: 'bulto' },
  { sku: 'PIN-001', name: 'Pintura blanca (galón)', unit: 'galón' },
  { sku: 'CAB-012', name: 'Cable eléctrico #12', unit: 'm' },
  { sku: 'GUA-001', name: 'Guantes de carnaza', unit: 'par' },
];

type WarehouseCode = 'BOD-A' | 'BOD-B' | 'BOD-C';
type Sku = 'TOR-014' | 'CEM-050' | 'PIN-001' | 'CAB-012' | 'GUA-001';

export function createDemoDataService(deps: DemoDataDeps): DemoDataService {
  return {
    async run({ adminEmail, managerEmail }) {
      if (await deps.catalog.hasMovements(DEMO_PRODUCTS.map((p) => p.sku))) return false;

      const adminId = await deps.findUserId(adminEmail.toLowerCase());
      const managerId = await deps.findUserId(managerEmail.toLowerCase());
      if (!adminId || !managerId) {
        throw new Error(
          'La demo necesita el ADMIN y el jefe de bodega: corre antes el seed de usuarios',
        );
      }
      const admin: Actor = { userId: adminId, role: 'ADMIN' };
      // El ADMIN no despacha ni recibe (separación de funciones): lo hace el jefe de bodega
      const manager: Actor = { userId: managerId, role: 'WAREHOUSE_MANAGER' };

      const warehouseIds = new Map<string, string>();
      for (const warehouse of DEMO_DATA_WAREHOUSES) {
        warehouseIds.set(warehouse.code, await deps.catalog.ensureWarehouse(warehouse));
      }
      const productIds = new Map<string, string>();
      for (const product of DEMO_PRODUCTS) {
        productIds.set(product.sku, await deps.catalog.ensureProduct(product));
      }
      const wh = (code: WarehouseCode): string => required(warehouseIds, code);
      const pr = (sku: Sku): string => required(productIds, sku);
      await deps.addWarehouses(managerId, [...warehouseIds.values()]);

      // 1. Inventario inicial (el ADMIN registra entradas en cualquier bodega); costos distintos
      //    para que el CPP se note: TOR-014 en A queda en (500×120 + 300×135) / 800 = 125,6250
      const entries: [WarehouseCode, Sku, number, string][] = [
        ['BOD-A', 'TOR-014', 500, '120'],
        ['BOD-A', 'TOR-014', 300, '135'],
        ['BOD-A', 'CEM-050', 80, '32000'],
        ['BOD-A', 'CEM-050', 40, '33500'],
        ['BOD-A', 'PIN-001', 60, '48000'],
        ['BOD-B', 'CAB-012', 1000, '2100'],
        ['BOD-B', 'GUA-001', 150, '9500'],
        ['BOD-B', 'TOR-014', 100, '130'],
        ['BOD-C', 'CEM-050', 30, '31000'],
        ['BOD-C', 'PIN-001', 20, '50000'],
      ];
      for (const [warehouse, sku, quantity, unitCost] of entries) {
        await deps.stock.registerEntry(
          { warehouseId: wh(warehouse), productId: pr(sku), quantity, unitCost },
          admin,
        );
      }

      const create = async (
        origin: WarehouseCode,
        destination: WarehouseCode,
        items: [Sku, number][],
        note: string,
      ): Promise<string> => {
        const transfer = await deps.transfers.create(
          {
            originWarehouseId: wh(origin),
            destinationWarehouseId: wh(destination),
            items: items.map(([sku, quantity]) => ({ productId: pr(sku), quantity })),
            note,
          },
          manager,
        );
        return transfer.id;
      };
      const receive = (id: string, items: [Sku, number][]) =>
        deps.transfers.receive(
          id,
          {
            items: items.map(([sku, receivedQuantity]) => ({
              productId: pr(sku),
              receivedQuantity,
            })),
          },
          manager,
        );

      // 2. Un traspaso en cada estado
      // RECEIVED: llega completo y el destino recalcula su CPP
      const received = await create(
        'BOD-A',
        'BOD-B',
        [
          ['TOR-014', 120],
          ['CEM-050', 20],
        ],
        'Reposición semanal de la Bodega B',
      );
      await deps.transfers.dispatch(received, manager);
      await receive(received, [
        ['TOR-014', 120],
        ['CEM-050', 20],
      ]);

      // RESOLVED: faltan 5 m de cable; el ADMIN lo resuelve como merma en tránsito
      const resolved = await create(
        'BOD-B',
        'BOD-C',
        [
          ['CAB-012', 200],
          ['GUA-001', 30],
        ],
        'Material para la obra del norte',
      );
      await deps.transfers.dispatch(resolved, manager);
      await receive(resolved, [
        ['CAB-012', 195],
        ['GUA-001', 30],
      ]);
      await deps.transfers.resolve(
        resolved,
        { reason: '5 m de cable dañados en el transporte' },
        admin,
      );

      // DISCREPANCY: llega un galón de más; queda pendiente para resolverlo en la demo
      const discrepancy = await create(
        'BOD-A',
        'BOD-C',
        [['PIN-001', 10]],
        'Pintura para la Bodega C',
      );
      await deps.transfers.dispatch(discrepancy, manager);
      await receive(discrepancy, [['PIN-001', 11]]);

      // IN_TRANSIT: despachado y sin recibir (aparece en el reporte de mercancía en tránsito)
      const inTransit = await create('BOD-C', 'BOD-A', [['CEM-050', 10]], 'Devolución de cemento');
      await deps.transfers.dispatch(inTransit, manager);

      // DRAFT: creado y sin despachar
      await create('BOD-A', 'BOD-B', [['PIN-001', 5]], 'Pedido pendiente de aprobación');

      // CANCELLED: solo se puede cancelar un borrador
      const cancelled = await create('BOD-B', 'BOD-A', [['CAB-012', 50]], 'Pedido duplicado');
      await deps.transfers.cancel(cancelled, { reason: 'Se pidió dos veces' }, manager);

      // 3. Mermas de bodega (al costo vigente, sin cambiar el CPP)
      const shrinkages: [WarehouseCode, Sku, number, 'DAMAGE' | 'THEFT', string][] = [
        ['BOD-A', 'TOR-014', 6, 'DAMAGE', 'Cajas mojadas por una gotera'],
        ['BOD-B', 'GUA-001', 3, 'THEFT', 'Faltante en el conteo semanal'],
        ['BOD-C', 'CEM-050', 2, 'DAMAGE', 'Bultos rotos al descargar'],
      ];
      for (const [warehouse, sku, quantity, reason, note] of shrinkages) {
        await deps.stock.registerShrinkage(
          { warehouseId: wh(warehouse), productId: pr(sku), quantity, reason, note },
          manager,
        );
      }
      return true;
    },
  };
}

function required(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (!id) throw new Error(`${key} no está en el catálogo de la demo`);
  return id;
}
