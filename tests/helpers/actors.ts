import type { Actor } from '../../src/domain/authorization';
import type { WarehouseAccess } from '../../src/services/warehouse-access';

export const ADMIN_ACTOR: Actor = { userId: 'u-admin', role: 'ADMIN' };

/** Acceso sin restricciones: para las pruebas que no tratan de la autorización por bodega. */
export const allowAllAccess: WarehouseAccess = {
  assert: async () => undefined,
  visibleIds: async () => null,
};
