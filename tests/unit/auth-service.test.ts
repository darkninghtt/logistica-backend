import { describe, expect, it, vi } from 'vitest';
import { UnauthorizedError } from '../../src/domain/errors';
import type { UserRecord } from '../../src/domain/user';
import {
  createAuthService,
  type PasswordHasher,
  type TokenService,
  type UserLookup,
} from '../../src/services/auth';

const admin: UserRecord = {
  id: 'u-1',
  email: 'admin@example.com',
  passwordHash: 'hash-correcto',
  name: 'Admin',
  role: 'ADMIN',
};

function setup(user: UserRecord | null = admin) {
  const users: UserLookup = {
    findByEmail: vi.fn(async () => user),
    findById: vi.fn(async () => user),
  };
  const hasher: PasswordHasher = {
    hash: vi.fn(async () => 'hash-de-relleno'),
    verify: vi.fn(async (hash, password) => hash === 'hash-correcto' && password === 'buena'),
  };
  const tokens: TokenService = {
    sign: vi.fn(() => 'token-firmado'),
    verify: vi.fn(() => ({ userId: 'u-1', role: 'ADMIN' as const })),
  };
  return { users, hasher, tokens, service: createAuthService({ users, hasher, tokens }) };
}

describe('AuthService.login', () => {
  it('con credenciales correctas devuelve el token y el usuario sin el hash', async () => {
    const { service, tokens } = setup();
    const result = await service.login('admin@example.com', 'buena');

    expect(result.accessToken).toBe('token-firmado');
    expect(result.user).toEqual({
      id: 'u-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
    expect(JSON.stringify(result)).not.toContain('hash');
    expect(tokens.sign).toHaveBeenCalledWith({ userId: 'u-1', role: 'ADMIN' });
  });

  it('rechaza una contraseña incorrecta con UnauthorizedError', async () => {
    const { service } = setup();
    await expect(service.login('admin@example.com', 'mala')).rejects.toBeInstanceOf(
      UnauthorizedError,
    );
  });

  it('rechaza un correo inexistente con el MISMO error y mensaje que una contraseña incorrecta', async () => {
    const existing = await setup()
      .service.login('admin@example.com', 'mala')
      .catch((e) => e);
    const missing = await setup(null)
      .service.login('nadie@example.com', 'buena')
      .catch((e) => e);

    expect(missing).toBeInstanceOf(UnauthorizedError);
    expect(missing.message).toBe(existing.message);
  });

  it('con un correo inexistente igual verifica una contraseña (no revela qué correos existen por tiempo)', async () => {
    const { service, hasher } = setup(null);
    await service.login('nadie@example.com', 'buena').catch(() => undefined);
    expect(hasher.verify).toHaveBeenCalledTimes(1);
  });

  it('no emite token cuando falla', async () => {
    const { service, tokens } = setup();
    await service.login('admin@example.com', 'mala').catch(() => undefined);
    expect(tokens.sign).not.toHaveBeenCalled();
  });
});

describe('AuthService.me', () => {
  it('devuelve los datos públicos del usuario', async () => {
    const { service } = setup();
    expect(await service.me('u-1')).toEqual({
      id: 'u-1',
      name: 'Admin',
      email: 'admin@example.com',
      role: 'ADMIN',
    });
  });

  it('falla con UnauthorizedError si el usuario ya no existe', async () => {
    const { service } = setup(null);
    await expect(service.me('u-1')).rejects.toBeInstanceOf(UnauthorizedError);
  });
});
