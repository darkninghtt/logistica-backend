import { ConflictError, ValidationError } from './errors';

export const TRANSFER_STATUSES = [
  'DRAFT',
  'IN_TRANSIT',
  'RECEIVED',
  'DISCREPANCY',
  'RESOLVED',
  'CANCELLED',
] as const;

export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

/** Único lugar donde se definen las transiciones válidas. Los estados finales no tienen salida. */
export const TRANSITIONS: Readonly<Record<TransferStatus, readonly TransferStatus[]>> = {
  DRAFT: ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT: ['RECEIVED', 'DISCREPANCY'],
  RECEIVED: [],
  DISCREPANCY: ['RESOLVED'],
  RESOLVED: [],
  CANCELLED: [],
};

/** Nombre en español de cada estado, para los mensajes que ve la persona usuaria. */
export const STATUS_LABELS: Readonly<Record<TransferStatus, string>> = {
  DRAFT: 'en borrador',
  IN_TRANSIT: 'en tránsito',
  RECEIVED: 'recibido',
  DISCREPANCY: 'con discrepancia',
  RESOLVED: 'resuelto',
  CANCELLED: 'cancelado',
};

export function canTransition(from: TransferStatus, to: TransferStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Lanza 409 INVALID_TRANSITION si el cambio de estado no está permitido. */
export function assertTransition(from: TransferStatus, to: TransferStatus): void {
  if (!canTransition(from, to)) {
    throw new ConflictError(
      `No se puede pasar el traspaso de ${from} a ${to}`,
      'INVALID_TRANSITION',
    );
  }
}

export interface SentItem {
  productId: string;
  quantitySent: number;
}

export interface ReceivedItem {
  productId: string;
  receivedQuantity: number;
}

/** Resultado de la recepción de un ítem. */
export interface ItemReceipt {
  productId: string;
  quantitySent: number;
  quantityReceived: number;
  /** Lo que entra de inmediato al destino: min(recibido, enviado). */
  entering: number;
  /** Enviado - recibido cuando llegó menos de lo enviado. */
  shortfall: number;
  /** Recibido - enviado cuando llegó más de lo enviado (queda retenido hasta resolver). */
  surplus: number;
}

export interface Receipt {
  items: ItemReceipt[];
  /** RECEIVED si todo coincide; DISCREPANCY si algún ítem difiere. */
  status: Extract<TransferStatus, 'RECEIVED' | 'DISCREPANCY'>;
}

/**
 * Compara lo enviado con lo que declara el destino. Función pura: no toca la BD.
 * Exige que se declaren todos los ítems del traspaso, sin repetidos ni extras.
 */
export function computeReceipt(
  sent: readonly SentItem[],
  received: readonly ReceivedItem[],
): Receipt {
  const declared = new Map<string, number>();
  for (const item of received) {
    if (declared.has(item.productId)) {
      throw new ValidationError('Hay un producto repetido en la recepción');
    }
    if (!Number.isInteger(item.receivedQuantity) || item.receivedQuantity < 0) {
      throw new ValidationError('La cantidad recibida debe ser un entero mayor o igual que 0');
    }
    declared.set(item.productId, item.receivedQuantity);
  }

  const sentIds = new Set(sent.map((item) => item.productId));
  if (declared.size !== sentIds.size || [...declared.keys()].some((id) => !sentIds.has(id))) {
    throw new ValidationError('La recepción debe declarar exactamente los productos del traspaso');
  }

  const items = sent.map((item): ItemReceipt => {
    const quantityReceived = declared.get(item.productId) ?? 0;
    return {
      productId: item.productId,
      quantitySent: item.quantitySent,
      quantityReceived,
      entering: Math.min(quantityReceived, item.quantitySent),
      shortfall: Math.max(item.quantitySent - quantityReceived, 0),
      surplus: Math.max(quantityReceived - item.quantitySent, 0),
    };
  });
  const matches = items.every((item) => item.shortfall === 0 && item.surplus === 0);
  return { items, status: matches ? 'RECEIVED' : 'DISCREPANCY' };
}

/** Bodega tal como se muestra dentro de un traspaso. */
export interface WarehouseRef {
  id: string;
  code: string;
  name: string;
}

/** Fila del listado de traspasos. */
export interface TransferSummary {
  id: string;
  status: TransferStatus;
  origin: WarehouseRef;
  destination: WarehouseRef;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TransferItemView {
  productId: string;
  productSku: string;
  productName: string;
  quantitySent: number;
  /** null hasta que el destino declara la recepción. */
  quantityReceived: number | null;
  /** Costo congelado al despachar; null mientras es borrador. */
  unitCost: string | null;
}

export interface TransferEventView {
  fromStatus: TransferStatus | null;
  toStatus: TransferStatus;
  actor: { id: string; name: string };
  reason: string | null;
  createdAt: string;
}

export interface TransferDetail extends Omit<TransferSummary, 'itemCount'> {
  note: string | null;
  createdBy: string;
  dispatchedBy: string | null;
  dispatchedAt: string | null;
  receivedBy: string | null;
  receivedAt: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  items: TransferItemView[];
  events: TransferEventView[];
}

export type TransferItemViewNoCost = Omit<TransferItemView, 'unitCost'>;
export type TransferDetailNoCost = Omit<TransferDetail, 'items'> & {
  items: TransferItemViewNoCost[];
};

/** Detalle sin costos: lo que recibe el OPERATOR. Copia explícita para que un campo nuevo no se filtre. */
export function withoutTransferCosts(detail: TransferDetail): TransferDetailNoCost {
  return {
    ...detail,
    items: detail.items.map((item) => ({
      productId: item.productId,
      productSku: item.productSku,
      productName: item.productName,
      quantitySent: item.quantitySent,
      quantityReceived: item.quantityReceived,
    })),
  };
}
