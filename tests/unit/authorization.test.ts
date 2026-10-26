import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import {
  assertRole,
  assertWarehouseAccess,
  hasGlobalScope,
  type Actor,
} from '../../src/domain/authorization';
import { ForbiddenError } from '../../src/domain/errors';
import { ROLES, type Role } from '../../src/domain/user';
import {
  withoutLevelCosts,
  withoutMovementCosts,
  type StockLevelItem,
  type StockMovementItem,
} from '../../src/domain/stock-queries';
import { errorHandler } from '../../src/middlewares/error-handler';
import { requireRole } from '../../src/middlewares/require-role';
import { createWarehouseAccess } from '../../src/services/warehouse-access';
import { createStockQueryService, type StockQueryStore } from '../../src/services/stock-queries';
import { allowAllAccess } from '../helpers/actors';

const WAREHOUSE_A = '0b0f1f5e-4f4e-4c3a-9a55-0d6f3d0f6a11';
const WAREHOUSE_B = '1c1a2b6f-5a5f-4d4b-8b66-1e7a4e1a7b22';

function actor(role: Role): Actor {
  return { userId: `u-${role}`, role };
}

describe('hasGlobalScope', () => {
  it.each([
    ['ADMIN', true],
    ['AUDITOR', true],
    ['WAREHOUSE_MANAGER', false],
    ['OPERATOR', false],
  ] as const)('%s → %s', (role, expected) => {
    expect(hasGlobalScope(role)).toBe(expected);
  });
});

describe('assertRole', () => {
  it('deja pasar a un rol permitido', () => {
    expect(() => assertRole(actor('ADMIN'), ['ADMIN', 'AUDITOR'])).not.toThrow();
  });

  it.each(ROLES.filter((r) => r !== 'ADMIN'))('rechaza a %s si solo se permite ADMIN', (role) => {
    expect(() => assertRole(actor(role), ['ADMIN'])).toThrow(ForbiddenError);
  });
});

describe('assertWarehouseAccess', () => {
  it.each(['ADMIN', 'AUDITOR'] as const)(
    '%s accede a cualquier bodega, aunque no tenga asignadas',
    (role) => {
      expect(() => assertWarehouseAccess(actor(role), WAREHOUSE_A, [])).not.toThrow();
    },
  );

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR'] as const)('%s accede a una bodega asignada', (role) => {
    expect(() =>
      assertWarehouseAccess(actor(role), WAREHOUSE_A, [WAREHOUSE_A, WAREHOUSE_B]),
    ).not.toThrow();
  });

  it.each(['WAREHOUSE_MANAGER', 'OPERATOR'] as const)('%s no accede a una bodega ajena', (role) => {
    expect(() => assertWarehouseAccess(actor(role), WAREHOUSE_B, [WAREHOUSE_A])).toThrow(
      ForbiddenError,
    );
  });

  it('sin bodegas asignadas, el jefe de bodega no accede a ninguna', () => {
    expect(() => assertWarehouseAccess(actor('WAREHOUSE_MANAGER'), WAREHOUSE_A, [])).toThrow(
      ForbiddenError,
    );
  });
});

describe('requireRole (middleware)', () => {
  /** App mínima: simula `authenticate` con el rol indicado (o sin identidad) y el manejador de errores real. */
  function appFor(role: Role | null, allowed: Role[]): express.Express {
    const app = express();
    app.use((req, _res, next) => {
      if (role) req.auth = actor(role);
      next();
    });
    app.get('/x', requireRole(...allowed), (_req, res) => {
      res.json({ ok: true });
    });
    app.use(errorHandler);
    return app;
  }

  it('sigue adelante si el rol está permitido', async () => {
    expect((await request(appFor('ADMIN', ['ADMIN'])).get('/x')).status).toBe(200);
    expect(
      (await request(appFor('WAREHOUSE_MANAGER', ['ADMIN', 'WAREHOUSE_MANAGER'])).get('/x')).status,
    ).toBe(200);
  });

  it('responde 403 FORBIDDEN si el rol no está permitido', async () => {
    const res = await request(appFor('OPERATOR', ['ADMIN'])).get('/x');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
    expect(
      (await request(appFor('AUDITOR', ['ADMIN', 'WAREHOUSE_MANAGER'])).get('/x')).status,
    ).toBe(403);
  });

  it('responde 401 si la petición no pasó por authenticate', async () => {
    expect((await request(appFor(null, ['ADMIN'])).get('/x')).status).toBe(401);
  });
});

describe('WarehouseAccess', () => {
  const warehouseIdsOf = vi.fn(async () => [WAREHOUSE_A]);
  const access = createWarehouseAccess({ assignments: { warehouseIdsOf } });

  it('con alcance global no consulta las asignaciones', async () => {
    warehouseIdsOf.mockClear();
    await access.assert(actor('AUDITOR'), WAREHOUSE_B);
    expect(await access.visibleIds(actor('ADMIN'))).toBeNull();
    expect(warehouseIdsOf).not.toHaveBeenCalled();
  });

  it('para el resto consulta las asignaciones del usuario y las aplica', async () => {
    await expect(access.assert(actor('OPERATOR'), WAREHOUSE_A)).resolves.toBeUndefined();
    await expect(access.assert(actor('OPERATOR'), WAREHOUSE_B)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(await access.visibleIds(actor('WAREHOUSE_MANAGER'))).toEqual([WAREHOUSE_A]);
    expect(warehouseIdsOf).toHaveBeenCalledWith('u-OPERATOR');
  });
});

describe('costos del stock', () => {
  const level: StockLevelItem = {
    productId: 'p',
    warehouseId: WAREHOUSE_A,
    quantity: 20,
    avgCost: '110.0000',
    totalValue: '2200.0000',
    productSku: 'SKU-1',
    productName: 'Tornillo',
    productUnit: 'un',
  };
  const movement: StockMovementItem = {
    id: '2',
    productId: 'p',
    warehouseId: WAREHOUSE_A,
    type: 'ENTRY',
    quantity: 10,
    unitCost: '120.0000',
    balanceQty: 20,
    balanceAvgCost: '110.0000',
    reason: null,
    transferId: null,
    createdBy: 'u-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    productSku: 'SKU-1',
    productName: 'Tornillo',
  };

  it('withoutLevelCosts y withoutMovementCosts quitan todos los campos de costo', () => {
    expect(Object.keys(withoutLevelCosts(level))).not.toEqual(expect.arrayContaining(['avgCost']));
    expect(withoutLevelCosts(level)).toEqual({
      productId: 'p',
      warehouseId: WAREHOUSE_A,
      quantity: 20,
      productSku: 'SKU-1',
      productName: 'Tornillo',
      productUnit: 'un',
    });
    const stripped = withoutMovementCosts(movement);
    expect(stripped).not.toHaveProperty('unitCost');
    expect(stripped).not.toHaveProperty('balanceAvgCost');
    expect(stripped).toMatchObject({ id: '2', quantity: 10, balanceQty: 20 });
  });

  function service(): ReturnType<typeof createStockQueryService> {
    const store: StockQueryStore = {
      warehouseExists: async () => true,
      productExists: async () => true,
      listLevels: async () => ({ rows: [level], total: 1 }),
      listMovements: async () => ({ rows: [movement], total: 1 }),
    };
    return createStockQueryService({ store, access: allowAllAccess });
  }
  const query = { warehouseId: WAREHOUSE_A, page: 1, pageSize: 20 };

  it.each(['ADMIN', 'AUDITOR', 'WAREHOUSE_MANAGER'] as const)(
    '%s recibe los costos',
    async (role) => {
      const levels = await service().listLevels(query, actor(role));
      const movements = await service().listMovements(query, actor(role));
      expect(levels.data[0]).toHaveProperty('avgCost', '110.0000');
      expect(levels.data[0]).toHaveProperty('totalValue', '2200.0000');
      expect(movements.data[0]).toHaveProperty('unitCost', '120.0000');
      expect(movements.data[0]).toHaveProperty('balanceAvgCost', '110.0000');
    },
  );

  it('OPERATOR no recibe ningún campo de costo', async () => {
    const levels = await service().listLevels(query, actor('OPERATOR'));
    const movements = await service().listMovements(query, actor('OPERATOR'));
    const json = JSON.stringify([levels, movements]);
    for (const field of ['avgCost', 'totalValue', 'unitCost', 'balanceAvgCost']) {
      expect(json).not.toContain(field);
    }
    expect(levels.data[0]).toMatchObject({ quantity: 20, productSku: 'SKU-1' });
  });

  it('el servicio rechaza una bodega ajena aunque el middleware no la haya filtrado', async () => {
    const store: StockQueryStore = {
      warehouseExists: async () => true,
      productExists: async () => true,
      listLevels: vi.fn(async () => ({ rows: [], total: 0 })),
      listMovements: vi.fn(async () => ({ rows: [], total: 0 })),
    };
    const guarded = createStockQueryService({
      store,
      access: createWarehouseAccess({ assignments: { warehouseIdsOf: async () => [WAREHOUSE_B] } }),
    });

    await expect(guarded.listLevels(query, actor('OPERATOR'))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    await expect(guarded.listMovements(query, actor('WAREHOUSE_MANAGER'))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(store.listLevels).not.toHaveBeenCalled();
    expect(store.listMovements).not.toHaveBeenCalled();
  });
});
