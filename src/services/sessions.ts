import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { UnauthorizedError } from '../domain/errors';
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
  start(userId: string): Promise<IssuedRefreshToken>;
  /** Canjea un refresh token por uno nuevo de la misma familia. Lanza UnauthorizedError si no sirve. */
  rotate(token: string): Promise<RotatedSession>;
  /** Cierra la sesión: revoca la familia del token. Un token desconocido se ignora. */
  end(token: string): Promise<void>;
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
  ): Promise<IssuedRefreshToken> {
    const token = generateRefreshToken();
    const expiresAt = new Date(now().getTime() + ttlSeconds * 1000);
    await target.insert({ userId, familyId, tokenHash: hashRefreshToken(token), expiresAt });
    return { token, expiresAt };
  }

  return {
    start(userId) {
      return issue(store, userId, randomUUID());
    },

    async rotate(token) {
      const tokenHash = hashRefreshToken(token);

      // Marcar el token como usado y emitir el nuevo va en una sola transacción: si algo falla,
      // el token viejo sigue siendo válido y el cliente puede reintentar.
      const outcome = await runInTransaction<RotateOutcome>(async (tx) => {
        const consumed = await tx.consume(tokenHash);
        if (!consumed) return { kind: 'missing' };
        const user = await users.findById(consumed.userId);
        if (!user?.active) return { kind: 'inactive', familyId: consumed.familyId };
        return { kind: 'ok', user, refresh: await issue(tx, user.id, consumed.familyId) };
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
  };
}
