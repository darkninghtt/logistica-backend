import type { Role } from '../domain/user';
import type { UserSeed } from './users';

export interface SeedWarehouse {
  code: string;
  name: string;
}

export interface SeedUser extends UserSeed {
  /** Códigos de las bodegas que se le asignan. */
  warehouseCodes: string[];
}

export interface SeedPlan {
  warehouses: SeedWarehouse[];
  users: SeedUser[];
}

export interface SeedResult {
  createdUsers: string[];
  existingUsers: string[];
}

export interface SeedService {
  run(plan: SeedPlan): Promise<SeedResult>;
}

export interface SeedDeps {
  /** Crea el usuario si no existe; true si lo creó. */
  ensureUser(seed: UserSeed): Promise<boolean>;
  findUserId(email: string): Promise<string | null>;
  /** Crea la bodega si no existe (por código) y devuelve su id. */
  ensureWarehouse(warehouse: SeedWarehouse): Promise<string>;
  addWarehouses(userId: string, warehouseIds: string[]): Promise<void>;
}

/** Siembra bodegas, usuarios y asignaciones. Es idempotente: se puede correr varias veces. */
export function createSeedService(deps: SeedDeps): SeedService {
  return {
    async run({ warehouses, users }) {
      const warehouseIds = new Map<string, string>();
      for (const warehouse of warehouses) {
        warehouseIds.set(warehouse.code, await deps.ensureWarehouse(warehouse));
      }

      const result: SeedResult = { createdUsers: [], existingUsers: [] };
      for (const { warehouseCodes, ...user } of users) {
        const created = await deps.ensureUser(user);
        (created ? result.createdUsers : result.existingUsers).push(user.email);

        const ids = warehouseCodes.map((code) => {
          const id = warehouseIds.get(code);
          if (!id) throw new Error(`La bodega ${code} no está en el plan del seed`);
          return id;
        });
        const userId = ids.length > 0 ? await deps.findUserId(user.email.toLowerCase()) : null;
        if (userId) await deps.addWarehouses(userId, ids);
      }
      return result;
    },
  };
}

/**
 * Roles que se siembran además del ADMIN, con el prefijo de sus variables y sus bodegas de ejemplo.
 * El jefe y el operario tienen las dos bodegas para poder recorrer un traspaso completo (origen y
 * destino) en la demo.
 */
export const DEMO_ROLES: ReadonlyArray<{
  role: Exclude<Role, 'ADMIN'>;
  envPrefix: string;
  name: string;
  warehouseCodes: string[];
}> = [
  {
    role: 'WAREHOUSE_MANAGER',
    envPrefix: 'SEED_MANAGER',
    name: 'Jefe de bodega',
    warehouseCodes: ['BOD-A', 'BOD-B'],
  },
  {
    role: 'OPERATOR',
    envPrefix: 'SEED_OPERATOR',
    name: 'Operario',
    warehouseCodes: ['BOD-A', 'BOD-B'],
  },
  { role: 'AUDITOR', envPrefix: 'SEED_AUDITOR', name: 'Auditor', warehouseCodes: [] },
];

export const DEMO_WAREHOUSES: SeedWarehouse[] = [
  { code: 'BOD-A', name: 'Bodega A' },
  { code: 'BOD-B', name: 'Bodega B' },
];
