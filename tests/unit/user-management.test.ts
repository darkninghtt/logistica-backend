import { describe, expect, it, vi } from 'vitest';
import { NotFoundError, ValidationError } from '../../src/domain/errors';
import type { ManagedUser } from '../../src/domain/user';
import { parseWith } from '../../src/schemas/parse';
import {
  createUserBodySchema,
  updateUserBodySchema,
  userWarehousesBodySchema,
} from '../../src/schemas/users';
import type { PasswordHasher } from '../../src/services/auth';
import {
  createUserManagementService,
  type UserManagementStore,
} from '../../src/services/user-management';
import { ADMIN_ACTOR } from '../helpers/actors';

const user: ManagedUser = {
  id: 'u-1',
  email: 'jefe@example.com',
  name: 'Jefe',
  role: 'WAREHOUSE_MANAGER',
  active: true,
  warehouseIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
};

const hasher: PasswordHasher = {
  hash: vi.fn(async (p) => `hash:${p}`),
  verify: vi.fn(async () => true),
};

function fakeStore(overrides: Partial<UserManagementStore> = {}): UserManagementStore {
  return {
    list: vi.fn(async () => ({ rows: [user], total: 41 })),
    findManagedById: vi.fn(async () => user),
    insert: vi.fn(async () => user),
    update: vi.fn(async () => user),
    replaceWarehouses: vi.fn(async () => undefined),
    ...overrides,
  };
}

describe('UserManagementService', () => {
  it('list calcula el desplazamiento y devuelve el formato de lista', async () => {
    const store = fakeStore();
    const result = await createUserManagementService({ users: store, hasher }).list(
      { page: 3, pageSize: 20 },
      ADMIN_ACTOR,
    );

    expect(store.list).toHaveBeenCalledWith(20, 40);
    expect(result).toEqual({ data: [user], page: 3, pageSize: 20, total: 41 });
  });

  it('create guarda el hash de la contraseña, nunca la contraseña', async () => {
    const store = fakeStore();
    await createUserManagementService({ users: store, hasher }).create(
      {
        email: 'a@b.co',
        name: 'A',
        role: 'OPERATOR',
        password: 'Clave-segura-123',
        active: true,
      },
      ADMIN_ACTOR,
    );

    expect(store.insert).toHaveBeenCalledWith({
      email: 'a@b.co',
      name: 'A',
      role: 'OPERATOR',
      active: true,
      passwordHash: 'hash:Clave-segura-123',
    });
  });

  it('update sin contraseña no envía hash; con contraseña lo envía', async () => {
    const store = fakeStore();
    const service = createUserManagementService({ users: store, hasher });
    const base = { email: 'a@b.co', name: 'A', role: 'OPERATOR', active: true } as const;

    await service.update('u-1', base, ADMIN_ACTOR);
    expect(store.update).toHaveBeenLastCalledWith('u-1', base);

    await service.update('u-1', { ...base, password: 'Clave-segura-123' }, ADMIN_ACTOR);
    expect(store.update).toHaveBeenLastCalledWith('u-1', {
      ...base,
      passwordHash: 'hash:Clave-segura-123',
    });
  });

  it('update de un usuario inexistente lanza NotFoundError', async () => {
    const service = createUserManagementService({
      users: fakeStore({ update: async () => null }),
      hasher,
    });
    await expect(
      service.update(
        'x',
        { email: 'a@b.co', name: 'A', role: 'OPERATOR', active: true },
        ADMIN_ACTOR,
      ),
    ).rejects.toThrow(NotFoundError);
  });

  it('setWarehouses reemplaza las bodegas y devuelve la lista ordenada', async () => {
    const store = fakeStore();
    const result = await createUserManagementService({ users: store, hasher }).setWarehouses(
      'u-1',
      ['b', 'a'],
      ADMIN_ACTOR,
    );

    expect(store.replaceWarehouses).toHaveBeenCalledWith('u-1', ['b', 'a']);
    expect(result).toEqual({ userId: 'u-1', warehouseIds: ['a', 'b'] });
  });

  it('setWarehouses de un usuario inexistente lanza NotFoundError sin tocar las asignaciones', async () => {
    const store = fakeStore({ findManagedById: async () => null });
    await expect(
      createUserManagementService({ users: store, hasher }).setWarehouses('x', [], ADMIN_ACTOR),
    ).rejects.toThrow(NotFoundError);
    expect(store.replaceWarehouses).not.toHaveBeenCalled();
  });
});

describe('esquemas de usuarios', () => {
  const valid = {
    email: ' Jefe@Example.COM ',
    name: ' Jefe ',
    role: 'OPERATOR',
    password: 'Clave-segura-123',
  };

  it('createUserBodySchema normaliza el correo y activa al usuario por defecto', () => {
    expect(parseWith(createUserBodySchema, valid)).toEqual({
      email: 'jefe@example.com',
      name: 'Jefe',
      role: 'OPERATOR',
      password: 'Clave-segura-123',
      active: true,
    });
  });

  it.each([
    [{ ...valid, role: 'SUPERMAN' }],
    [{ ...valid, email: 'no-es-correo' }],
    [{ ...valid, password: 'corta' }],
    [{ ...valid, name: '  ' }],
    [{ ...valid, active: 'si' }],
    [undefined],
  ])('createUserBodySchema rechaza %o', (body) => {
    expect(() => parseWith(createUserBodySchema, body)).toThrow(ValidationError);
  });

  it('updateUserBodySchema hace opcional la contraseña pero exige active', () => {
    const base = { email: 'a@b.co', name: 'A', role: 'AUDITOR' };
    expect(parseWith(updateUserBodySchema, { ...base, active: false }).password).toBeUndefined();
    expect(() => parseWith(updateUserBodySchema, base)).toThrow(ValidationError);
    expect(() =>
      parseWith(updateUserBodySchema, { ...base, active: true, password: 'corta' }),
    ).toThrow(ValidationError);
  });

  it('userWarehousesBodySchema quita repetidos y exige identificadores válidos', () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(parseWith(userWarehousesBodySchema, { warehouseIds: [id, id] }).warehouseIds).toEqual([
      id,
    ]);
    expect(() => parseWith(userWarehousesBodySchema, { warehouseIds: ['x'] })).toThrow(
      ValidationError,
    );
    expect(() => parseWith(userWarehousesBodySchema, {})).toThrow(ValidationError);
  });
});
