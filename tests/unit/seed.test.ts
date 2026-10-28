import { describe, expect, it, vi } from 'vitest';
import { buildSeedPlan, DEV_PASSWORDS } from '../../src/seed-plan';
import { createSeedService, type SeedDeps } from '../../src/services/seed';

const ADMIN_ENV = {
  SEED_ADMIN_EMAIL: 'admin@logistica.local',
  SEED_ADMIN_PASSWORD: 'Admin-dev-2026!',
};
const DEMO_ENV = {
  SEED_MANAGER_EMAIL: 'jefe@logistica.local',
  SEED_MANAGER_PASSWORD: 'Jefe-dev-2026!',
  SEED_OPERATOR_EMAIL: 'operario@logistica.local',
  SEED_OPERATOR_PASSWORD: 'Operario-dev-2026!',
  SEED_AUDITOR_EMAIL: 'auditor@logistica.local',
  SEED_AUDITOR_PASSWORD: 'Auditor-dev-2026!',
};

describe('buildSeedPlan', () => {
  it('en desarrollo siembra un usuario por rol con bodegas de ejemplo', () => {
    const plan = buildSeedPlan({ ...ADMIN_ENV, ...DEMO_ENV });

    expect(plan.users.map((u) => u.role)).toEqual([
      'ADMIN',
      'WAREHOUSE_MANAGER',
      'OPERATOR',
      'AUDITOR',
    ]);
    expect(plan.warehouses.map((w) => w.code)).toEqual(['BOD-A', 'BOD-B']);
    expect(plan.users.find((u) => u.role === 'WAREHOUSE_MANAGER')?.warehouseCodes).toEqual([
      'BOD-A',
      'BOD-B',
    ]);
    expect(plan.users.find((u) => u.role === 'OPERATOR')?.warehouseCodes).toEqual([
      'BOD-A',
      'BOD-B',
    ]);
    expect(plan.users.find((u) => u.role === 'AUDITOR')?.warehouseCodes).toEqual([]);
  });

  it('solo con el ADMIN no siembra bodegas ni otros usuarios', () => {
    const plan = buildSeedPlan(ADMIN_ENV);
    expect(plan.users).toHaveLength(1);
    expect(plan.warehouses).toEqual([]);
  });

  it('en producción rechaza las contraseñas de desarrollo', () => {
    const env = { NODE_ENV: 'production', ...ADMIN_ENV, ...DEMO_ENV };
    expect(() => buildSeedPlan(env)).toThrow(/producción/);
  });

  it('en producción acepta contraseñas propias para todos los roles', () => {
    const plan = buildSeedPlan({
      NODE_ENV: 'production',
      SEED_ADMIN_EMAIL: 'admin@empresa.co',
      SEED_ADMIN_PASSWORD: 'Produccion-admin-1',
      SEED_MANAGER_EMAIL: 'jefe@empresa.co',
      SEED_MANAGER_PASSWORD: 'Produccion-jefe-1',
    });
    expect(plan.users.map((u) => u.role)).toEqual(['ADMIN', 'WAREHOUSE_MANAGER']);
  });

  it('las contraseñas de desarrollo conocidas están en la lista de rechazo', () => {
    for (const password of [ADMIN_ENV.SEED_ADMIN_PASSWORD, ...Object.values(DEMO_ENV)]) {
      if (password.includes('-dev-')) expect(DEV_PASSWORDS.has(password)).toBe(true);
    }
  });

  it.each([
    [{}],
    [{ ...ADMIN_ENV, SEED_ADMIN_PASSWORD: 'corta' }],
    [{ ...ADMIN_ENV, SEED_MANAGER_EMAIL: 'jefe@logistica.local' }],
    [{ ...ADMIN_ENV, SEED_OPERATOR_PASSWORD: 'Operario-dev-2026!' }],
    [
      {
        ...ADMIN_ENV,
        SEED_AUDITOR_EMAIL: 'no-es-correo',
        SEED_AUDITOR_PASSWORD: 'Auditor-dev-2026!',
      },
    ],
  ])('rechaza la configuración incompleta o inválida %o', (env) => {
    expect(() => buildSeedPlan(env)).toThrow();
  });
});

describe('SeedService', () => {
  function fakeDeps(existing: string[] = []): SeedDeps {
    return {
      ensureUser: vi.fn(async (u) => !existing.includes(u.email)),
      findUserId: vi.fn(async (email) => `id:${email}`),
      ensureWarehouse: vi.fn(async (w) => `w:${w.code}`),
      addWarehouses: vi.fn(async () => undefined),
    };
  }

  const plan = buildSeedPlan({ ...ADMIN_ENV, ...DEMO_ENV });

  it('crea los usuarios y asigna las bodegas de ejemplo', async () => {
    const deps = fakeDeps();
    const result = await createSeedService(deps).run(plan);

    expect(result.createdUsers).toHaveLength(4);
    expect(result.existingUsers).toEqual([]);
    expect(deps.addWarehouses).toHaveBeenCalledWith('id:jefe@logistica.local', [
      'w:BOD-A',
      'w:BOD-B',
    ]);
    expect(deps.addWarehouses).toHaveBeenCalledWith('id:operario@logistica.local', [
      'w:BOD-A',
      'w:BOD-B',
    ]);
    expect(deps.addWarehouses).toHaveBeenCalledTimes(2);
  });

  it('distingue los usuarios que ya existían', async () => {
    const result = await createSeedService(fakeDeps(['admin@logistica.local'])).run(plan);
    expect(result.existingUsers).toEqual(['admin@logistica.local']);
    expect(result.createdUsers).toHaveLength(3);
  });

  it('falla si un usuario pide una bodega que no está en el plan', async () => {
    const [admin] = plan.users;
    const bad = {
      warehouses: [],
      users: admin ? [{ ...admin, warehouseCodes: ['NO-EXISTE'] }] : [],
    };
    await expect(createSeedService(fakeDeps()).run(bad)).rejects.toThrow(/NO-EXISTE/);
  });
});
