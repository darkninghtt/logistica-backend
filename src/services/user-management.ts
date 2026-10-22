import { assertRole, type Actor } from '../domain/authorization';
import { NotFoundError } from '../domain/errors';
import type { Page } from '../domain/page';
import type { ManagedUser, Role } from '../domain/user';
import type { PageQuery } from '../schemas/page';
import type { CreateUserInput, UpdateUserInput } from '../schemas/users';
import type { PasswordHasher } from './auth';

/** Lo que el servicio necesita de la persistencia (la implementa el repositorio de usuarios). */
export interface UserManagementStore {
  list(limit: number, offset: number): Promise<{ rows: ManagedUser[]; total: number }>;
  findManagedById(id: string): Promise<ManagedUser | null>;
  insert(user: {
    email: string;
    passwordHash: string;
    name: string;
    role: Role;
    active: boolean;
  }): Promise<ManagedUser>;
  update(
    id: string,
    changes: { email: string; name: string; role: Role; active: boolean; passwordHash?: string },
  ): Promise<ManagedUser | null>;
  replaceWarehouses(userId: string, warehouseIds: string[]): Promise<void>;
}

export interface UserManagementService {
  /** Todas las operaciones son solo del ADMIN. */
  list(query: PageQuery, actor: Actor): Promise<Page<ManagedUser>>;
  create(input: CreateUserInput, actor: Actor): Promise<ManagedUser>;
  update(id: string, input: UpdateUserInput, actor: Actor): Promise<ManagedUser>;
  /** Reemplaza las bodegas del usuario. 404 si el usuario o alguna bodega no existe. */
  setWarehouses(
    id: string,
    warehouseIds: string[],
    actor: Actor,
  ): Promise<{ userId: string; warehouseIds: string[] }>;
}

export function createUserManagementService({
  users,
  hasher,
}: {
  users: UserManagementStore;
  hasher: PasswordHasher;
}): UserManagementService {
  return {
    async list({ page, pageSize }, actor) {
      assertRole(actor, ['ADMIN']);
      const { rows, total } = await users.list(pageSize, (page - 1) * pageSize);
      return { data: rows, page, pageSize, total };
    },

    async create({ password, ...rest }, actor) {
      assertRole(actor, ['ADMIN']);
      return users.insert({ ...rest, passwordHash: await hasher.hash(password) });
    },

    async update(id, { password, ...rest }, actor) {
      assertRole(actor, ['ADMIN']);
      const passwordHash = password === undefined ? undefined : await hasher.hash(password);
      const updated = await users.update(id, { ...rest, ...(passwordHash && { passwordHash }) });
      if (!updated) {
        throw new NotFoundError('El usuario no existe');
      }
      return updated;
    },

    async setWarehouses(id, warehouseIds, actor) {
      assertRole(actor, ['ADMIN']);
      if (!(await users.findManagedById(id))) {
        throw new NotFoundError('El usuario no existe');
      }
      await users.replaceWarehouses(id, warehouseIds);
      return { userId: id, warehouseIds: [...warehouseIds].sort() };
    },
  };
}
