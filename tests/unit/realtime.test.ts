import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../src/domain/authorization';
import { ConflictError } from '../../src/domain/errors';
import { shouldReceive, type RealtimeEvent } from '../../src/domain/realtime';
import type { StockLevel, StockMovement } from '../../src/domain/stock';
import {
  createRealtimeService,
  TICKET_TTL_SECONDS,
  type RealtimeConnection,
} from '../../src/services/realtime';
import { createStockService, type StockStore } from '../../src/services/stock';
import type { WarehouseAccess } from '../../src/services/warehouse-access';
import { allowAllAccess } from '../helpers/actors';

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PRODUCT = '11111111-1111-4111-8111-111111111111';

const ADMIN: Actor = { userId: 'u-admin', role: 'ADMIN' };
const MANAGER_B: Actor = { userId: 'u-manager-b', role: 'WAREHOUSE_MANAGER' };
const OPERATOR_C: Actor = { userId: 'u-operator-c', role: 'OPERATOR' };

const DISPATCHED: RealtimeEvent = {
  type: 'transfer.updated',
  payload: {
    transferId: 't-1',
    status: 'IN_TRANSIT',
    originWarehouseId: A,
    destinationWarehouseId: B,
  },
};

/** Acceso de prueba: ADMIN todas, el jefe B y el operario C cada uno su bodega. */
const access: WarehouseAccess = {
  assert: async () => undefined,
  visibleIds: async (actor) =>
    ({ [MANAGER_B.userId]: [B], [OPERATOR_C.userId]: [C] })[actor.userId] ?? null,
};

function connection(actor: Actor): RealtimeConnection & { received: string[] } {
  const received: string[] = [];
  return {
    actor,
    received,
    send(message) {
      received.push(message);
    },
  };
}

describe('shouldReceive', () => {
  it('con alcance global recibe todo', () => {
    expect(shouldReceive(DISPATCHED, null)).toBe(true);
  });

  it('el origen o el destino de un traspaso lo reciben; una bodega ajena no', () => {
    expect(shouldReceive(DISPATCHED, [A])).toBe(true);
    expect(shouldReceive(DISPATCHED, [B])).toBe(true);
    expect(shouldReceive(DISPATCHED, [C])).toBe(false);
    expect(shouldReceive(DISPATCHED, [])).toBe(false);
  });

  it('un cambio de stock lo recibe solo quien tiene esa bodega', () => {
    const event: RealtimeEvent = {
      type: 'stock.changed',
      payload: { warehouseId: C, productIds: [PRODUCT] },
    };
    expect(shouldReceive(event, [C])).toBe(true);
    expect(shouldReceive(event, [A, B])).toBe(false);
  });
});

describe('tickets del WebSocket', () => {
  it('un ticket sirve una sola vez y devuelve a quién pertenece', () => {
    const service = createRealtimeService({ access });
    const { ticket, expiresIn } = service.issueTicket(MANAGER_B);

    expect(expiresIn).toBe(TICKET_TTL_SECONDS);
    expect(ticket.length).toBeGreaterThanOrEqual(40);
    expect(service.redeemTicket(ticket)).toEqual(MANAGER_B);
    expect(service.redeemTicket(ticket)).toBeNull();
  });

  it('un ticket vencido no sirve, ni siquiera la primera vez', () => {
    let clock = 1_000_000;
    const service = createRealtimeService({ access, now: () => clock });
    const { ticket } = service.issueTicket(MANAGER_B);

    clock += TICKET_TTL_SECONDS * 1000;

    expect(service.redeemTicket(ticket)).toBeNull();
  });

  it('un ticket inventado no sirve y cada ticket es distinto', () => {
    const service = createRealtimeService({ access });
    expect(service.redeemTicket('inventado')).toBeNull();
    expect(service.issueTicket(ADMIN).ticket).not.toBe(service.issueTicket(ADMIN).ticket);
  });
});

describe('publish', () => {
  it('envía el evento solo a quien tiene acceso a alguna de sus bodegas', async () => {
    const service = createRealtimeService({ access });
    const admin = connection(ADMIN);
    const managerB = connection(MANAGER_B);
    const operatorC = connection(OPERATOR_C);
    for (const c of [admin, managerB, operatorC]) service.connect(c);

    await service.publish(DISPATCHED);

    expect(admin.received).toEqual([JSON.stringify(DISPATCHED)]);
    expect(managerB.received).toEqual([JSON.stringify(DISPATCHED)]);
    expect(operatorC.received).toEqual([]);
  });

  it('una conexión cerrada ya no recibe nada', async () => {
    const service = createRealtimeService({ access });
    const admin = connection(ADMIN);
    service.connect(admin);
    service.disconnect(admin);

    await service.publish(DISPATCHED);

    expect(admin.received).toEqual([]);
  });

  it('si falla la consulta de acceso no envía nada a nadie (el reintento no duplica)', async () => {
    const failing: WarehouseAccess = {
      assert: async () => undefined,
      visibleIds: async (actor) => {
        if (actor.userId === OPERATOR_C.userId) throw new Error('BD caída');
        return null;
      },
    };
    const service = createRealtimeService({ access: failing });
    const admin = connection(ADMIN);
    service.connect(admin);
    service.connect(connection(OPERATOR_C));

    await expect(service.publish(DISPATCHED)).rejects.toThrow('BD caída');
    expect(admin.received).toEqual([]);
  });
});

describe('los servicios publican solo después del COMMIT', () => {
  function store(): StockStore {
    return {
      ensureLevel: vi.fn(async () => undefined),
      lockLevel: vi.fn(async () => ({ quantity: 5, avgCost: '10.0000' })),
      saveLevel: vi.fn(async (productId, warehouseId, balance): Promise<StockLevel> => ({
        productId,
        warehouseId,
        ...balance,
        totalValue: '0.0000',
      })),
      insertMovement: vi.fn(async (m): Promise<StockMovement> => ({
        reason: null,
        transferId: null,
        ...m,
        id: '1',
        createdAt: '2026-01-01T00:00:00.000Z',
      })),
    };
  }

  it('una entrada confirmada avisa stock.changed una vez, cuando la transacción ya terminó', async () => {
    const order: string[] = [];
    const service = createStockService({
      access: allowAllAccess,
      runInTransaction: async (work) => {
        const result = await work(store());
        order.push('COMMIT');
        return result;
      },
      events: { publish: (event) => order.push(event.type) },
    });

    await service.registerEntry(
      { productId: PRODUCT, warehouseId: A, quantity: 1, unitCost: '1' },
      ADMIN,
    );

    expect(order).toEqual(['COMMIT', 'stock.changed']);
  });

  it('si la transacción falla (ROLLBACK) no avisa nada', async () => {
    const publish = vi.fn();
    const service = createStockService({
      access: allowAllAccess,
      runInTransaction: async () => {
        throw new ConflictError('No hay stock suficiente', 'INSUFFICIENT_STOCK');
      },
      events: { publish },
    });

    await expect(
      service.registerShrinkage(
        { productId: PRODUCT, warehouseId: A, quantity: 99, reason: 'DAMAGE' },
        { userId: 'u-op', role: 'OPERATOR' },
      ),
    ).rejects.toThrow(ConflictError);
    expect(publish).not.toHaveBeenCalled();
  });
});
