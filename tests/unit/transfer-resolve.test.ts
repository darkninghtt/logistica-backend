import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../src/domain/authorization';
import { ForbiddenError, NotFoundError } from '../../src/domain/errors';
import type { StockLevel, StockMovement } from '../../src/domain/stock';
import {
  createTransfersService,
  type TransferHead,
  type TransferReadStore,
  type TransferTx,
  type TransferWriteStore,
} from '../../src/services/transfers';
import { allowAllAccess } from '../helpers/actors';

const TRANSFER = '11111111-1111-4111-8111-111111111111';
const ORIGIN = '22222222-2222-4222-8222-222222222222';
const DESTINATION = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const MANAGER = '55555555-5555-4555-8555-555555555555';

const ACTOR: Actor = { userId: MANAGER, role: 'WAREHOUSE_MANAGER' };

function head(receivedBy: string | null): TransferHead {
  return {
    id: TRANSFER,
    status: 'DISCREPANCY',
    originId: ORIGIN,
    destinationId: DESTINATION,
    createdBy: 'otro',
    receivedBy,
  };
}

function fakeTx(findHead: TransferWriteStore['findHead']): {
  tx: TransferTx;
  transition: ReturnType<typeof vi.fn>;
} {
  const transition = vi.fn(async () => true);
  const transfers: TransferWriteStore = {
    findHead,
    insertTransfer: vi.fn(async () => TRANSFER),
    transition,
    insertEvent: vi.fn(async () => undefined),
    listItems: vi.fn(async () => [
      { productId: PRODUCT, quantitySent: 8, unitCost: '110.0000', quantityReceived: 7 },
    ]),
    freezeItemCost: vi.fn(async () => undefined),
    setReceivedQuantity: vi.fn(async () => undefined),
  };
  const tx: TransferTx = {
    transfers,
    stock: {
      ensureLevel: vi.fn(async () => undefined),
      lockLevel: vi.fn(async () => ({ quantity: 7, avgCost: '110.0000' })),
      saveLevel: vi.fn(async (): Promise<StockLevel> => {
        throw new Error('una merma en tránsito no debe mover el stock');
      }),
      insertMovement: vi.fn(async (m): Promise<StockMovement> => ({
        reason: null,
        transferId: null,
        ...m,
        id: '1',
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    },
  };
  return { tx, transition };
}

function serviceWith(heads: (TransferHead | null)[]) {
  // Una sola cola de lecturas: dentro y fuera de la transacción salen en el orden en que se piden
  const findHead = vi.fn(async () => heads.shift() ?? null);
  const { tx, transition } = fakeTx(findHead);
  const store: TransferReadStore = {
    list: vi.fn(async () => ({ rows: [], total: 0 })),
    findDetail: vi.fn(async () => null),
    findHead,
    inactiveWarehouseIds: vi.fn(async () => []),
  };
  const service = createTransfersService({
    store,
    runInTransaction: (work) => work(tx),
    access: allowAllAccess,
  });
  return { service, tx, transition };
}

describe('TransfersService.resolve: separación de funciones', () => {
  it('quien recibió es rechazado antes de abrir la transacción', async () => {
    const { service, transition } = serviceWith([head(MANAGER)]);

    await expect(service.resolve(TRANSFER, { reason: 'x' }, ACTOR)).rejects.toThrow(ForbiddenError);
    expect(transition).not.toHaveBeenCalled();
  });

  it('si la recepción ocurrió justo después de la primera lectura, se rechaza dentro de la transacción', async () => {
    // Primera lectura: aún nadie había recibido. Segunda (con el estado ya bloqueado): recibió el mismo actor.
    const { service, tx } = serviceWith([head(null), head(MANAGER)]);

    await expect(service.resolve(TRANSFER, { reason: 'x' }, ACTOR)).rejects.toThrow(ForbiddenError);
    // La excepción hace rollback: no se llegó a escribir ningún movimiento
    expect(tx.stock.insertMovement).not.toHaveBeenCalled();
  });

  it('si otra persona recibió, resuelve y la merma en tránsito no guarda el nivel del stock', async () => {
    const { service, tx } = serviceWith([head('otra-persona'), head('otra-persona'), null]);

    // El detalle final no existe en el fake: lo que importa es lo que se escribió antes
    await expect(service.resolve(TRANSFER, { reason: 'Se perdió' }, ACTOR)).rejects.toThrow(
      NotFoundError,
    );
    expect(tx.stock.insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'TRANSIT_SHRINKAGE',
        quantity: 1,
        unitCost: '110.0000',
        balanceQty: 7,
        balanceAvgCost: '110.0000',
        reason: 'Se perdió',
        transferId: TRANSFER,
      }),
    );
    expect(tx.stock.saveLevel).not.toHaveBeenCalled();
  });
});
