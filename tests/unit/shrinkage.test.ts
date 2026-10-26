import { describe, expect, it, vi } from 'vitest';
import type { Actor } from '../../src/domain/authorization';
import { ConflictError, ForbiddenError, ValidationError } from '../../src/domain/errors';
import {
  applyShrinkage,
  levelWithoutCosts,
  movementWithoutCosts,
  shrinkageReasonText,
  type StockLevel,
  type StockMovement,
} from '../../src/domain/stock';
import { parseWith } from '../../src/schemas/parse';
import { stockShrinkageBodySchema } from '../../src/schemas/stock';
import {
  createStockService,
  type StockShrinkageResult,
  type StockStore,
} from '../../src/services/stock';
import type { WarehouseAccess } from '../../src/services/warehouse-access';
import { allowAllAccess } from '../helpers/actors';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const WAREHOUSE = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

function actor(role: Actor['role']): Actor {
  return { userId: USER, role };
}

const INPUT = {
  productId: PRODUCT,
  warehouseId: WAREHOUSE,
  quantity: 3,
  reason: 'DAMAGE',
} as const;

describe('applyShrinkage', () => {
  it('descuenta la cantidad y no cambia el costo promedio', () => {
    expect(applyShrinkage({ quantity: 12, avgCost: '110.0000' }, 2)).toEqual({
      quantity: 10,
      avgCost: '110.0000',
    });
  });

  it('puede dejar el stock en cero', () => {
    expect(applyShrinkage({ quantity: 5, avgCost: '10.5000' }, 5)).toEqual({
      quantity: 0,
      avgCost: '10.5000',
    });
  });

  it('mermar más de lo disponible lanza 409 INSUFFICIENT_STOCK', () => {
    const attempt = (): unknown => applyShrinkage({ quantity: 5, avgCost: '10.0000' }, 6);
    expect(attempt).toThrow(ConflictError);
    expect(attempt).toThrow(expect.objectContaining({ code: 'INSUFFICIENT_STOCK', status: 409 }));
  });

  it('mermar en un nivel sin stock también es 409', () => {
    expect(() => applyShrinkage({ quantity: 0, avgCost: '0.0000' }, 1)).toThrow(ConflictError);
  });

  it.each([0, -1, 1.5, Number.NaN])('rechaza la cantidad %s', (quantity) => {
    expect(() => applyShrinkage({ quantity: 10, avgCost: '1.0000' }, quantity)).toThrow(
      ValidationError,
    );
  });
});

describe('shrinkageReasonText', () => {
  it('sin nota deja solo el código del motivo', () => {
    expect(shrinkageReasonText('EXPIRED')).toBe('EXPIRED');
  });

  it('con nota deja "CÓDIGO: nota"', () => {
    expect(shrinkageReasonText('DAMAGE', 'Caja mojada')).toBe('DAMAGE: Caja mojada');
  });

  it('una nota vacía se ignora', () => {
    expect(shrinkageReasonText('THEFT', '')).toBe('THEFT');
  });
});

describe('stockShrinkageBodySchema', () => {
  const valid = { warehouseId: WAREHOUSE, productId: PRODUCT, quantity: 2, reason: 'DAMAGE' };

  it.each(['DAMAGE', 'EXPIRED', 'THEFT', 'COUNT_ADJUSTMENT'])('acepta el motivo %s', (reason) => {
    expect(parseWith(stockShrinkageBodySchema, { ...valid, reason }).reason).toBe(reason);
  });

  it('la nota es opcional y se recorta', () => {
    expect(parseWith(stockShrinkageBodySchema, valid).note).toBeUndefined();
    expect(parseWith(stockShrinkageBodySchema, { ...valid, note: '  humedad  ' }).note).toBe(
      'humedad',
    );
  });

  it.each([
    ['motivo inválido', { ...valid, reason: 'LOST' }],
    ['sin motivo', { ...valid, reason: undefined }],
    ['cantidad 0', { ...valid, quantity: 0 }],
    ['cantidad negativa', { ...valid, quantity: -2 }],
    ['cantidad decimal', { ...valid, quantity: 1.5 }],
    ['cantidad como texto', { ...valid, quantity: '2' }],
    ['bodega que no es uuid', { ...valid, warehouseId: 'x' }],
    ['producto que no es uuid', { ...valid, productId: 'x' }],
    ['nota demasiado larga', { ...valid, note: 'a'.repeat(501) }],
  ])('rechaza: %s', (_name, body) => {
    expect(() => parseWith(stockShrinkageBodySchema, body)).toThrow(ValidationError);
  });
});

describe('movimientos y niveles sin costos', () => {
  const movement: StockMovement = {
    id: '1',
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    type: 'SHRINKAGE',
    quantity: 2,
    unitCost: '110.0000',
    balanceQty: 10,
    balanceAvgCost: '110.0000',
    reason: 'DAMAGE',
    transferId: null,
    createdBy: USER,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
  const level: StockLevel = {
    productId: PRODUCT,
    warehouseId: WAREHOUSE,
    quantity: 10,
    avgCost: '110.0000',
    totalValue: '1100.0000',
  };

  it('el movimiento no trae unitCost ni balanceAvgCost y conserva el resto', () => {
    const result = movementWithoutCosts(movement);
    expect(result).not.toHaveProperty('unitCost');
    expect(result).not.toHaveProperty('balanceAvgCost');
    expect(result).toMatchObject({ type: 'SHRINKAGE', quantity: 2, balanceQty: 10 });
  });

  it('el nivel no trae avgCost ni totalValue y conserva la cantidad', () => {
    const result = levelWithoutCosts(level);
    expect(result).not.toHaveProperty('avgCost');
    expect(result).not.toHaveProperty('totalValue');
    expect(result.quantity).toBe(10);
  });
});

function fakeStore(current = { quantity: 10, avgCost: '110.0000' }): {
  store: StockStore;
  calls: string[];
  insertMovement: ReturnType<typeof vi.fn>;
} {
  const calls: string[] = [];
  const insertMovement = vi.fn(async (m): Promise<StockMovement> => {
    calls.push('insertMovement');
    return { reason: null, transferId: null, ...m, id: '1', createdAt: '2026-01-01T00:00:00.000Z' };
  });
  const store: StockStore = {
    ensureLevel: vi.fn(async () => {
      calls.push('ensureLevel');
    }),
    lockLevel: vi.fn(async () => {
      calls.push('lockLevel');
      return current;
    }),
    saveLevel: vi.fn(async (productId, warehouseId, balance): Promise<StockLevel> => {
      calls.push('saveLevel');
      return { productId, warehouseId, ...balance, totalValue: '0.0000' };
    }),
    insertMovement,
  };
  return { store, calls, insertMovement };
}

describe('StockService.registerShrinkage', () => {
  it('bloquea el nivel y guarda nivel y movimiento SHRINKAGE al costo vigente, en ese orden', async () => {
    const { store, calls, insertMovement } = fakeStore();
    const service = createStockService({
      runInTransaction: (work) => work(store),
      access: allowAllAccess,
    });

    const result = await service.registerShrinkage(
      { ...INPUT, note: 'Caja mojada' },
      actor('WAREHOUSE_MANAGER'),
    );

    expect(calls).toEqual(['ensureLevel', 'lockLevel', 'saveLevel', 'insertMovement']);
    expect(insertMovement).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SHRINKAGE',
        quantity: 3,
        unitCost: '110.0000',
        balanceQty: 7,
        balanceAvgCost: '110.0000',
        createdBy: USER,
        reason: 'DAMAGE: Caja mojada',
      }),
    );
    expect(result.stockLevel).toMatchObject({ quantity: 7, avgCost: '110.0000' });
  });

  it('si no hay stock suficiente lanza 409 y no guarda nada', async () => {
    const { store, calls } = fakeStore({ quantity: 2, avgCost: '110.0000' });
    const service = createStockService({
      runInTransaction: (work) => work(store),
      access: allowAllAccess,
    });

    await expect(service.registerShrinkage(INPUT, actor('OPERATOR'))).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
    });
    expect(calls).toEqual(['ensureLevel', 'lockLevel']);
  });

  it.each(['ADMIN', 'AUDITOR'] as const)(
    'el rol %s es rechazado antes de abrir la transacción',
    async (role) => {
      const runInTransaction = vi.fn();
      const service = createStockService({ runInTransaction, access: allowAllAccess });

      await expect(service.registerShrinkage(INPUT, actor(role))).rejects.toThrow(ForbiddenError);
      expect(runInTransaction).not.toHaveBeenCalled();
    },
  );

  it('una bodega no asignada es rechazada antes de abrir la transacción', async () => {
    const runInTransaction = vi.fn();
    const denyAccess: WarehouseAccess = {
      assert: async () => {
        throw new ForbiddenError('No tienes acceso a esa bodega');
      },
      visibleIds: async () => [],
    };
    const service = createStockService({ runInTransaction, access: denyAccess });

    await expect(service.registerShrinkage(INPUT, actor('WAREHOUSE_MANAGER'))).rejects.toThrow(
      ForbiddenError,
    );
    expect(runInTransaction).not.toHaveBeenCalled();
  });

  it('el OPERATOR recibe la respuesta sin campos de costo y el jefe, completa', async () => {
    const run = async (role: Actor['role']): Promise<StockShrinkageResult> => {
      const { store } = fakeStore();
      return createStockService({
        runInTransaction: (work) => work(store),
        access: allowAllAccess,
      }).registerShrinkage(INPUT, actor(role));
    };

    const operator = await run('OPERATOR');
    expect(operator.movement).not.toHaveProperty('unitCost');
    expect(operator.movement).not.toHaveProperty('balanceAvgCost');
    expect(operator.stockLevel).not.toHaveProperty('avgCost');
    expect(operator.stockLevel).not.toHaveProperty('totalValue');

    const manager = await run('WAREHOUSE_MANAGER');
    expect(manager.movement).toHaveProperty('unitCost', '110.0000');
    expect(manager.stockLevel).toHaveProperty('avgCost', '110.0000');
  });
});
