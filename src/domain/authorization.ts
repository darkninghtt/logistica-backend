import { ForbiddenError } from './errors';
import type { Role } from './user';

/** Quién hace la petición: sale del access token, nunca del cuerpo de la petición. */
export interface Actor {
  userId: string;
  role: Role;
}

/** Roles que operan sobre todas las bodegas sin necesitar una asignación. */
const GLOBAL_SCOPE_ROLES: readonly Role[] = ['ADMIN', 'AUDITOR'];

export function hasGlobalScope(role: Role): boolean {
  return GLOBAL_SCOPE_ROLES.includes(role);
}

/** RBAC: lanza ForbiddenError si el rol del actor no está entre los permitidos. */
export function assertRole(actor: Actor, allowed: readonly Role[]): void {
  if (!allowed.includes(actor.role)) {
    throw new ForbiddenError();
  }
}

/**
 * ABAC: lanza ForbiddenError si el actor no puede operar sobre la bodega. ADMIN y AUDITOR tienen
 * alcance global; el resto solo sobre las bodegas que tiene asignadas.
 */
export function assertWarehouseAccess(
  actor: Actor,
  warehouseId: string,
  assignedWarehouseIds: readonly string[],
): void {
  if (hasGlobalScope(actor.role)) return;
  if (!assignedWarehouseIds.includes(warehouseId)) {
    throw new ForbiddenError('No tienes acceso a esa bodega');
  }
}
