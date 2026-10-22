import { assertWarehouseAccess, hasGlobalScope, type Actor } from '../domain/authorization';

/** Lo que se necesita de la persistencia: las bodegas asignadas a un usuario. */
export interface AssignmentLookup {
  warehouseIdsOf(userId: string): Promise<string[]>;
}

export interface WarehouseAccess {
  /** Lanza ForbiddenError si el actor no puede operar sobre la bodega. */
  assert(actor: Actor, warehouseId: string): Promise<void>;
  /** Ids de las bodegas visibles para el actor; `null` significa todas. */
  visibleIds(actor: Actor): Promise<string[] | null>;
}

export function createWarehouseAccess({
  assignments,
}: {
  assignments: AssignmentLookup;
}): WarehouseAccess {
  return {
    async assert(actor, warehouseId) {
      // Con alcance global no hace falta consultar asignaciones
      const assigned = hasGlobalScope(actor.role)
        ? []
        : await assignments.warehouseIdsOf(actor.userId);
      assertWarehouseAccess(actor, warehouseId, assigned);
    },

    async visibleIds(actor) {
      return hasGlobalScope(actor.role) ? null : assignments.warehouseIdsOf(actor.userId);
    },
  };
}
