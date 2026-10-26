import { describe, expect, it } from 'vitest';
import { ConflictError, ValidationError } from '../../src/domain/errors';
import {
  TRANSFER_STATUSES,
  TRANSITIONS,
  assertTransition,
  canTransition,
  computeReceipt,
  type TransferStatus,
} from '../../src/domain/transfer';

const VALID: [TransferStatus, TransferStatus][] = [
  ['DRAFT', 'IN_TRANSIT'],
  ['DRAFT', 'CANCELLED'],
  ['IN_TRANSIT', 'RECEIVED'],
  ['IN_TRANSIT', 'DISCREPANCY'],
  ['DISCREPANCY', 'RESOLVED'],
];

const INVALID = TRANSFER_STATUSES.flatMap((from) =>
  TRANSFER_STATUSES.filter(
    (to) => !VALID.some(([validFrom, validTo]) => validFrom === from && validTo === to),
  ).map((to): [TransferStatus, TransferStatus] => [from, to]),
);

describe('máquina de estados del traspaso', () => {
  it('hay 5 transiciones válidas y el resto de los 36 pares son inválidos', () => {
    expect(VALID).toHaveLength(5);
    expect(INVALID).toHaveLength(TRANSFER_STATUSES.length ** 2 - VALID.length);
  });

  it.each(VALID)('permite %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  it.each(INVALID)('rechaza %s -> %s con 409 INVALID_TRANSITION', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(ConflictError);
    expect(() => assertTransition(from, to)).toThrow(
      expect.objectContaining({ code: 'INVALID_TRANSITION', status: 409 }),
    );
  });

  it.each(['RECEIVED', 'RESOLVED', 'CANCELLED'] as const)('%s es un estado final', (status) => {
    expect(TRANSITIONS[status]).toEqual([]);
  });
});

const sent = [
  { productId: 'a', quantitySent: 10 },
  { productId: 'b', quantitySent: 5 },
];

describe('computeReceipt', () => {
  it('todo coincide: RECEIVED y entra lo enviado', () => {
    const receipt = computeReceipt(sent, [
      { productId: 'b', receivedQuantity: 5 },
      { productId: 'a', receivedQuantity: 10 },
    ]);
    expect(receipt.status).toBe('RECEIVED');
    expect(receipt.items.map((i) => [i.productId, i.entering, i.shortfall, i.surplus])).toEqual([
      ['a', 10, 0, 0],
      ['b', 5, 0, 0],
    ]);
  });

  it('faltante: DISCREPANCY, entra lo recibido y la diferencia queda como faltante', () => {
    const receipt = computeReceipt(sent, [
      { productId: 'a', receivedQuantity: 7 },
      { productId: 'b', receivedQuantity: 5 },
    ]);
    expect(receipt.status).toBe('DISCREPANCY');
    expect(receipt.items[0]).toMatchObject({
      entering: 7,
      shortfall: 3,
      surplus: 0,
      quantityReceived: 7,
    });
  });

  it('sobrante: DISCREPANCY, entra solo lo enviado y el resto queda retenido', () => {
    const receipt = computeReceipt(sent, [
      { productId: 'a', receivedQuantity: 12 },
      { productId: 'b', receivedQuantity: 5 },
    ]);
    expect(receipt.status).toBe('DISCREPANCY');
    expect(receipt.items[0]).toMatchObject({
      entering: 10,
      shortfall: 0,
      surplus: 2,
      quantityReceived: 12,
    });
  });

  it('mezcla de faltante y sobrante en ítems distintos', () => {
    const receipt = computeReceipt(sent, [
      { productId: 'a', receivedQuantity: 8 },
      { productId: 'b', receivedQuantity: 6 },
    ]);
    expect(receipt.status).toBe('DISCREPANCY');
    expect(receipt.items.map((i) => [i.entering, i.shortfall, i.surplus])).toEqual([
      [8, 2, 0],
      [5, 0, 1],
    ]);
  });

  it('recibido cero: no entra nada y todo es faltante', () => {
    const receipt = computeReceipt(sent, [
      { productId: 'a', receivedQuantity: 0 },
      { productId: 'b', receivedQuantity: 0 },
    ]);
    expect(receipt.status).toBe('DISCREPANCY');
    expect(receipt.items.map((i) => [i.entering, i.shortfall])).toEqual([
      [0, 10],
      [0, 5],
    ]);
  });

  it.each([
    ['falta un ítem', [{ productId: 'a', receivedQuantity: 10 }]],
    [
      'sobra un ítem que no está en el traspaso',
      [
        { productId: 'a', receivedQuantity: 10 },
        { productId: 'b', receivedQuantity: 5 },
        { productId: 'c', receivedQuantity: 1 },
      ],
    ],
    [
      'un ítem está repetido',
      [
        { productId: 'a', receivedQuantity: 10 },
        { productId: 'a', receivedQuantity: 10 },
      ],
    ],
    [
      'la cantidad es negativa',
      [
        { productId: 'a', receivedQuantity: -1 },
        { productId: 'b', receivedQuantity: 5 },
      ],
    ],
    [
      'la cantidad es decimal',
      [
        { productId: 'a', receivedQuantity: 1.5 },
        { productId: 'b', receivedQuantity: 5 },
      ],
    ],
  ])('rechaza la recepción si %s', (_caso, received) => {
    expect(() => computeReceipt(sent, received)).toThrow(ValidationError);
  });
});
