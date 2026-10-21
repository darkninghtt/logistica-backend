import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../src/domain/errors';
import type { UserRecord } from '../../src/domain/user';
import {
  createSessionService,
  hashRefreshToken,
  type NewRefreshToken,
  type RefreshTokenStore,
} from '../../src/services/sessions';

const user: UserRecord = {
  id: 'u-1',
  email: 'a@example.com',
  passwordHash: 'h',
  name: 'A',
  role: 'ADMIN',
  active: true,
};

interface Row extends NewRefreshToken {
  used: boolean;
  revoked: boolean;
}

/** Almacén en memoria con la misma semántica que el repositorio SQL. */
function fakeStore(rows: Row[]): RefreshTokenStore {
  return {
    async insert(token) {
      rows.push({ ...token, used: false, revoked: false });
    },
    async consume(tokenHash) {
      const row = rows.find(
        (r) => r.tokenHash === tokenHash && !r.used && !r.revoked && r.expiresAt > new Date(),
      );
      if (!row) return null;
      row.used = true;
      return { userId: row.userId, familyId: row.familyId };
    },
    async find(tokenHash) {
      const row = rows.find((r) => r.tokenHash === tokenHash);
      return row
        ? { userId: row.userId, familyId: row.familyId, used: row.used, revoked: row.revoked }
        : null;
    },
    async revokeFamily(familyId) {
      for (const row of rows) if (row.familyId === familyId) row.revoked = true;
    },
  };
}

function setup(account: UserRecord | null = user) {
  const rows: Row[] = [];
  const store = fakeStore(rows);
  const service = createSessionService({
    store,
    runInTransaction: (work) => work(store),
    users: { findById: async () => account },
    ttlSeconds: 3600,
  });
  return { rows, service };
}

describe('SessionService', () => {
  it('start guarda solo el hash del token, nunca el valor', async () => {
    const { rows, service } = setup();
    const { token } = await service.start('u-1');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tokenHash).toBe(hashRefreshToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('rotate emite un token nuevo de la misma familia y marca el anterior como usado', async () => {
    const { rows, service } = setup();
    const first = await service.start('u-1');
    const { refresh, user: who } = await service.rotate(first.token);

    expect(who.id).toBe('u-1');
    expect(refresh.token).not.toBe(first.token);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.used).toBe(true);
    expect(rows[1]?.familyId).toBe(rows[0]?.familyId);
  });

  it('reutilizar un token ya rotado da 401 y revoca toda la familia', async () => {
    const { rows, service } = setup();
    const first = await service.start('u-1');
    const second = await service.rotate(first.token);

    await expect(service.rotate(first.token)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(rows.every((r) => r.revoked)).toBe(true);
    // el token más nuevo de la familia también dejó de servir
    await expect(service.rotate(second.refresh.token)).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it('un token inexistente da 401 y no toca otras familias', async () => {
    const { rows, service } = setup();
    await service.start('u-1');
    await expect(service.rotate('no-existe')).rejects.toBeInstanceOf(UnauthorizedError);
    expect(rows[0]?.revoked).toBe(false);
  });

  it('un token vencido da 401 sin revocar la familia', async () => {
    const { rows, service } = setup();
    const { token } = await service.start('u-1');
    if (rows[0]) rows[0].expiresAt = new Date(Date.now() - 1000);

    await expect(service.rotate(token)).rejects.toBeInstanceOf(UnauthorizedError);
    expect(rows[0]?.revoked).toBe(false);
  });

  it('un usuario desactivado o inexistente no renueva y se revoca la familia', async () => {
    for (const account of [{ ...user, active: false }, null]) {
      const { rows, service } = setup(account);
      const { token } = await service.start('u-1');
      await expect(service.rotate(token)).rejects.toBeInstanceOf(UnauthorizedError);
      expect(rows.every((r) => r.revoked)).toBe(true);
    }
  });

  it('end revoca la familia; luego el token no sirve y un token desconocido se ignora', async () => {
    const { rows, service } = setup();
    const { token } = await service.start('u-1');

    await service.end(token);
    expect(rows[0]?.revoked).toBe(true);
    await expect(service.rotate(token)).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(service.end('desconocido')).resolves.toBeUndefined();
  });
});
