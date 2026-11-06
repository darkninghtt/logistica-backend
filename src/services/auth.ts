import { UnauthorizedError, ValidationError } from '../domain/errors';
import { toPublicUser, type PublicUser, type Role, type UserRecord } from '../domain/user';
import type { IssuedRefreshToken, SessionInfo, SessionService } from './sessions';

/** Lo que el servicio necesita del repositorio de usuarios (la implementación está en repositories/). */
export interface UserLookup {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  updatePasswordHash(id: string, passwordHash: string): Promise<void>;
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
  /** `userAgent` es el navegador que inicia sesión: se guarda para la lista de sesiones. */
  login(email: string, password: string, userAgent?: string): Promise<SessionResult>;
  /** Renueva la sesión con el refresh token (rotativo). Falla con UnauthorizedError si no sirve. */
  refresh(refreshToken: string, userAgent?: string): Promise<SessionResult>;
  /** Cierra la sesión revocando la familia del refresh token. */
  logout(refreshToken: string): Promise<void>;
  /** Datos públicos del usuario autenticado; falla si el usuario ya no existe. */
  me(userId: string): Promise<PublicUser>;
  /** Sesiones activas propias; marca la del refresh token de la cookie, si viene. */
  listSessions(userId: string, refreshToken?: string): Promise<SessionInfo[]>;
  /** Cierra una sesión propia (404 si es ajena, no existe o ya estaba cerrada). */
  revokeSession(userId: string, sessionId: string): Promise<void>;
  /** Cierra todas las sesiones del usuario, incluida la actual. */
  logoutAll(userId: string): Promise<void>;
  /**
   * Cambia la propia contraseña verificando la actual (incorrecta: ValidationError, 400) y cierra
   * las demás sesiones. La del refresh token indicado (la de quien la cambia) sigue abierta.
   */
  changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string },
    refreshToken?: string,
  ): Promise<void>;
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
    async login(email, password, userAgent) {
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
        refresh: await sessions.start(user.id, userAgent),
      };
    },

    async refresh(refreshToken, userAgent) {
      const { user, refresh } = await sessions.rotate(refreshToken, userAgent);
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

    listSessions(userId, refreshToken) {
      return sessions.list(userId, refreshToken);
    },

    revokeSession(userId, sessionId) {
      return sessions.revoke(userId, sessionId);
    },

    logoutAll(userId) {
      return sessions.revokeAll(userId);
    },

    async changePassword(userId, { currentPassword, newPassword }, refreshToken) {
      const user = await users.findById(userId);
      if (!user?.active) {
        throw new UnauthorizedError('Token inválido o expirado');
      }
      if (!(await hasher.verify(user.passwordHash, currentPassword))) {
        throw new ValidationError('La contraseña actual no es correcta');
      }
      await users.updatePasswordHash(user.id, await hasher.hash(newPassword));
      // Quien tenga la contraseña vieja (o una sesión robada) queda fuera; quien la cambió, no
      await sessions.revokeAll(user.id, { keepToken: refreshToken });
    },
  };
}
