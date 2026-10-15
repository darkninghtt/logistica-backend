import type { Role } from '../domain/user';
import type { NewUser } from '../repositories/users';
import type { PasswordHasher } from './auth';

export interface UserWriter {
  insertIfAbsent(user: NewUser): Promise<boolean>;
}

export interface AdminSeed {
  email: string;
  password: string;
  name: string;
}

export interface UsersService {
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
  const adminRole: Role = 'ADMIN';

  return {
    async ensureAdmin({ email, password, name }) {
      const passwordHash = await hasher.hash(password);
      return users.insertIfAbsent({
        email: email.toLowerCase(),
        passwordHash,
        name,
        role: adminRole,
      });
    },
  };
}
