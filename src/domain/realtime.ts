import type { TransferStatus } from './transfer';

/**
 * Eventos de tiempo real (servidor → cliente). No llevan costos ni datos sensibles: avisan qué
 * cambió y el cliente vuelve a pedir el detalle por la API, que ya filtra por rol.
 */
export type RealtimeEvent =
  | {
      type: 'transfer.updated';
      payload: {
        transferId: string;
        status: TransferStatus;
        originWarehouseId: string;
        destinationWarehouseId: string;
      };
    }
  | {
      type: 'stock.changed';
      payload: { warehouseId: string; productIds: string[] };
    };

/** Lo que usan los servicios para avisar de un cambio ya confirmado en la BD. */
export interface EventPublisher {
  publish(event: RealtimeEvent): void;
}

/** Publicador que no hace nada: para los servicios que se arman sin tiempo real (pruebas). */
export const noEvents: EventPublisher = { publish: () => undefined };

/** Bodegas a las que se refiere el evento. */
export function eventWarehouseIds(event: RealtimeEvent): string[] {
  return event.type === 'transfer.updated'
    ? [event.payload.originWarehouseId, event.payload.destinationWarehouseId]
    : [event.payload.warehouseId];
}

/**
 * Quién recibe el evento: con alcance global (`visibleIds` null: ADMIN y AUDITOR) siempre; el
 * resto, solo si alguna de las bodegas del evento está entre las suyas.
 */
export function shouldReceive(event: RealtimeEvent, visibleIds: readonly string[] | null): boolean {
  if (visibleIds === null) return true;
  return eventWarehouseIds(event).some((id) => visibleIds.includes(id));
}
