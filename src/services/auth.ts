import { UnauthorizedError } from '../domain/errors';
import { toPublicUser, type PublicUser, type Role, type UserRecord } from '../domain/user';
import type { IssuedRefreshToken, SessionService } from './sessions';

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

/** Resultado de abrir o renovar la sesión: el refresh token va aparte (viaja en una cookie). */
export interface SessionResult extends LoginResult {
  refresh: IssuedRefreshToken;
}

export interface AuthService {
  login(email: string, password: string): Promise<SessionResult>;
  /** Renueva la sesión con el refresh token (rotativo). Falla con UnauthorizedError si no sirve. */
  refresh(refreshToken: string): Promise<SessionResult>;
  /** Cierra la sesión revocando la familia del refresh token. */
  logout(refreshToken: string): Promise<void>;
  /** Datos públicos del usuario autenticado; falla si el usuario ya no existe. */
  me(userId: string): Promise<PublicUser>;
}

export interface AuthDeps {
  users: UserLookup;
  hasher: PasswordHasher;
  tokens: TokenService;
  sessions: SessionService;
}

const INVALID_CREDENTIALS = 'Correo o contraseña incorrectos';

export function createAuthService({ users, hasher, tokens, sessions }: AuthDeps): AuthService {
  // Hash de relleno: si el correo no existe igual se verifica una contraseña, para que
  // la respuesta tarde parecido y no revele qué correos están registrados.
  const dummyHash = hasher.hash('relleno-para-igualar-tiempos');

  return {
    async login(email, password) {
      const user = await users.findByEmail(email);
      const hash = user ? user.passwordHash : await dummyHash;
      const passwordOk = await hasher.verify(hash, password);

      if (!user || !passwordOk || !user.active) {
        // Mismo error para "no existe", "contraseña incorrecta" y "usuario desactivado"
        throw new UnauthorizedError(INVALID_CREDENTIALS);
      }

      return {
        accessToken: tokens.sign({ userId: user.id, role: user.role }),
        user: toPublicUser(user),
        refresh: await sessions.start(user.id),
      };
    },

    async refresh(refreshToken) {
      const { user, refresh } = await sessions.rotate(refreshToken);
      return {
        accessToken: tokens.sign({ userId: user.id, role: user.role }),
        user: toPublicUser(user),
        refresh,
      };
    },

    logout(refreshToken) {
      return sessions.end(refreshToken);
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
