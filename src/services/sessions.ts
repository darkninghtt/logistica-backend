import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { NotFoundError, UnauthorizedError } from '../domain/errors';
import type { UserRecord } from '../domain/user';

export interface IssuedRefreshToken {
  /** Valor que viaja en la cookie. Solo existe en memoria; en BD se guarda su hash. */
  token: string;
  expiresAt: Date;
}

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  /** Navegador que abrió o renovó la sesión (encabezado User-Agent), si lo envió. */
  userAgent: string | null;
}

/** Una familia con un token vigente, tal como la guarda la BD. */
export interface ActiveFamily {
  familyId: string;
  userAgent: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/** Sesión activa tal como la ve su dueño (GET /api/auth/sessions). */
export interface SessionInfo {
  id: string;
  userAgent: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  /** Es la sesión desde la que se consulta (la de la cookie). */
  current: boolean;
}

export interface StoredRefreshToken {
  userId: string;
  familyId: string;
  used: boolean;
  revoked: boolean;
}

/** Lo que el servicio necesita del repositorio de refresh tokens (se implementa en repositories/). */
export interface RefreshTokenStore {
  insert(token: NewRefreshToken): Promise<void>;
  /** Marca como usado un token sin usar, vigente y sin revocar. Devuelve null si no hay tal token. */
  consume(tokenHash: string): Promise<{ userId: string; familyId: string } | null>;
  find(tokenHash: string): Promise<StoredRefreshToken | null>;
  revokeFamily(familyId: string): Promise<void>;
  /** Familias del usuario con un token vigente. */
  listActive(userId: string): Promise<ActiveFamily[]>;
  /** Revoca la familia solo si es de ese usuario y está activa. Devuelve false si no había tal. */
  revokeFamilyOfUser(familyId: string, userId: string): Promise<boolean>;
  /** Revoca todas las familias del usuario, salvo `exceptFamilyId` si se indica. */
  revokeAllOfUser(userId: string, exceptFamilyId: string | null): Promise<void>;
}

export interface SessionUsers {
  findById(id: string): Promise<UserRecord | null>;
}

export interface RotatedSession {
  user: UserRecord;
  refresh: IssuedRefreshToken;
}

export interface SessionService {
  /** Abre una sesión nueva (una familia nueva de refresh tokens) para el usuario. */
  start(userId: string, userAgent?: string | null): Promise<IssuedRefreshToken>;
  /** Canjea un refresh token por uno nuevo de la misma familia. Lanza UnauthorizedError si no sirve. */
  rotate(token: string, userAgent?: string | null): Promise<RotatedSession>;
  /** Cierra la sesión: revoca la familia del token. Un token desconocido se ignora. */
  end(token: string): Promise<void>;
  /** Sesiones activas del usuario; marca como `current` la del token indicado (la cookie). */
  list(userId: string, currentToken?: string): Promise<SessionInfo[]>;
  /** Cierra una sesión propia. Una ajena, inexistente o ya cerrada da NotFoundError. */
  revoke(userId: string, sessionId: string): Promise<void>;
  /**
   * Cierra todas las sesiones del usuario. Con `keepToken` conserva la de ese token (cambiar la
   * propia contraseña no debe sacar a quien la cambia).
   */
  revokeAll(userId: string, options?: { keepToken?: string }): Promise<void>;
}

export interface SessionDeps {
  /** Acceso directo (fuera de una transacción). */
  store: RefreshTokenStore;
  /** Ejecuta `work` en una transacción con un store ligado a ella. */
  runInTransaction<T>(work: (store: RefreshTokenStore) => Promise<T>): Promise<T>;
  users: SessionUsers;
  ttlSeconds: number;
  now?: () => Date;
}

export function generateRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const INVALID_SESSION = 'Sesión inválida o expirada';
/** Tope del User-Agent guardado: es solo para reconocer la sesión en la lista. */
export const MAX_USER_AGENT_LENGTH = 300;

function cleanUserAgent(userAgent: string | null | undefined): string | null {
  const value = userAgent?.trim();
  return value ? value.slice(0, MAX_USER_AGENT_LENGTH) : null;
}

type RotateOutcome =
  | { kind: 'ok'; user: UserRecord; refresh: IssuedRefreshToken }
  | { kind: 'inactive'; familyId: string }
  | { kind: 'missing' };

export function createSessionService({
  store,
  runInTransaction,
  users,
  ttlSeconds,
  now = () => new Date(),
}: SessionDeps): SessionService {
  async function issue(
    target: RefreshTokenStore,
    userId: string,
    familyId: string,
    userAgent: string | null,
  ): Promise<IssuedRefreshToken> {
    const token = generateRefreshToken();
    const expiresAt = new Date(now().getTime() + ttlSeconds * 1000);
    await target.insert({
      userId,
      familyId,
      tokenHash: hashRefreshToken(token),
      expiresAt,
      userAgent,
    });
    return { token, expiresAt };
  }

  /** Familia del token si es de ese usuario; si no (o no hay token), null. */
  async function familyOf(userId: string, token: string | undefined): Promise<string | null> {
    if (!token) return null;
    const known = await store.find(hashRefreshToken(token));
    return known && known.userId === userId ? known.familyId : null;
  }

  return {
    start(userId, userAgent) {
      return issue(store, userId, randomUUID(), cleanUserAgent(userAgent));
    },

    async rotate(token, userAgent) {
      const tokenHash = hashRefreshToken(token);

      // Marcar el token como usado y emitir el nuevo va en una sola transacción: si algo falla,
      // el token viejo sigue siendo válido y el cliente puede reintentar.
      const outcome = await runInTransaction<RotateOutcome>(async (tx) => {
        const consumed = await tx.consume(tokenHash);
        if (!consumed) return { kind: 'missing' };
        const user = await users.findById(consumed.userId);
        if (!user?.active) return { kind: 'inactive', familyId: consumed.familyId };
        const refresh = await issue(tx, user.id, consumed.familyId, cleanUserAgent(userAgent));
        return { kind: 'ok', user, refresh };
      });

      if (outcome.kind === 'ok') return { user: outcome.user, refresh: outcome.refresh };

      if (outcome.kind === 'inactive') {
        await store.revokeFamily(outcome.familyId);
        throw new UnauthorizedError(INVALID_SESSION);
      }

      // No se pudo canjear: si el token existe y ya estaba usado o revocado, alguien lo está
      // reutilizando (posible robo) y se revoca toda la familia. Si solo venció, no.
      const known = await store.find(tokenHash);
      if (known && (known.used || known.revoked)) {
        await store.revokeFamily(known.familyId);
      }
      throw new UnauthorizedError(INVALID_SESSION);
    },

    async end(token) {
      const known = await store.find(hashRefreshToken(token));
      if (known) await store.revokeFamily(known.familyId);
    },

    async list(userId, currentToken) {
      const [families, currentFamily] = await Promise.all([
        store.listActive(userId),
        familyOf(userId, currentToken),
      ]);
      return families.map((family) => ({
        id: family.familyId,
        userAgent: family.userAgent,
        createdAt: family.createdAt.toISOString(),
        lastUsedAt: family.lastUsedAt?.toISOString() ?? null,
        current: family.familyId === currentFamily,
      }));
    },

    async revoke(userId, sessionId) {
      // Misma respuesta para una sesión ajena que para una inexistente: no se revela si existe
      if (!(await store.revokeFamilyOfUser(sessionId, userId))) {
        throw new NotFoundError('La sesión no existe');
      }
    },

    async revokeAll(userId, { keepToken } = {}) {
      await store.revokeAllOfUser(userId, await familyOf(userId, keepToken));
    },
  };
}
