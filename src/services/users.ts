import type { Role } from '../domain/user';
import type { NewUser } from '../repositories/users';
import type { PasswordHasher } from './auth';

export interface UserWriter {
  insertIfAbsent(user: NewUser): Promise<boolean>;
}

export interface UserSeed {
  email: string;
  password: string;
  name: string;
  role: Role;
}

export type AdminSeed = Omit<UserSeed, 'role'>;

export interface UsersService {
  /** Crea el usuario si no existe (por correo). Devuelve true si lo creó, false si ya estaba. */
  ensureUser(seed: UserSeed): Promise<boolean>;
  /** Crea el usuario ADMIN si no existe. Devuelve true si lo creó, false si ya estaba. */
  ensureAdmin(seed: AdminSeed): Promise<boolean>;
}

export function createUsersService({
  users,
  hasher,
}: {
  users: UserWriter;
  hasher: PasswordHasher;
}): UsersService {
  async function ensureUser({ email, password, name, role }: UserSeed): Promise<boolean> {
    const passwordHash = await hasher.hash(password);
    return users.insertIfAbsent({ email: email.toLowerCase(), passwordHash, name, role });
  }

  return {
    ensureUser,
    ensureAdmin: (seed) => ensureUser({ ...seed, role: 'ADMIN' }),
  };
}
