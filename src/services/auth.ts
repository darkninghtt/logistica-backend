import { UnauthorizedError } from '../domain/errors';
import { toPublicUser, type PublicUser, type Role, type UserRecord } from '../domain/user';

/** Lo que el servicio necesita del repositorio de usuarios (la implementación está en repositories/). */
export interface UserLookup {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface AuthIdentity {
  userId: string;
  role: Role;
}

export interface TokenService {
  sign(identity: AuthIdentity): string;
  /** Devuelve la identidad si el token es válido y vigente; si no, lanza UnauthorizedError. */
  verify(token: string): AuthIdentity;
}

export interface LoginResult {
  accessToken: string;
  user: PublicUser;
}

export interface AuthService {
  login(email: string, password: string): Promise<LoginResult>;
  /** Datos públicos del usuario autenticado; falla si el usuario ya no existe. */
  me(userId: string): Promise<PublicUser>;
}

export interface AuthDeps {
  users: UserLookup;
  hasher: PasswordHasher;
  tokens: TokenService;
}

const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';

export function createAuthService({ users, hasher, tokens }: AuthDeps): AuthService {
  // Hash de relleno: si el correo no existe igual se verifica una contraseña, para que
  // la respuesta tarde parecido y no revele qué correos están registrados.
  const dummyHash = hasher.hash('relleno-para-igualar-tiempos');

  return {
    async login(email, password) {
      const user = await users.findByEmail(email);
      const hash = user ? user.passwordHash : await dummyHash;
      const passwordOk = await hasher.verify(hash, password);

      if (!user || !passwordOk) {
        // Mismo error para "no existe" y "contraseña incorrecta"
        throw new UnauthorizedError(INVALID_CREDENTIALS);
      }

      return {
        accessToken: tokens.sign({ userId: user.id, role: user.role }),
        user: toPublicUser(user),
      };
    },

    async me(userId) {
      const user = await users.findById(userId);
      if (!user) {
        throw new UnauthorizedError('Token inválido o expirado');
      }
      return toPublicUser(user);
    },
  };
}
