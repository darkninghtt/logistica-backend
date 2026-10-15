import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '../../src/domain/errors';
import { loginSchema } from '../../src/schemas/auth';
import { parseWith } from '../../src/schemas/parse';
import type { PasswordHasher } from '../../src/services/auth';
import { createUsersService } from '../../src/services/users';

describe('loginSchema', () => {
  it('normaliza el correo (espacios y mayúsculas)', () => {
    expect(parseWith(loginSchema, { email: '  Admin@Example.COM ', password: 'x' }).email).toBe(
      'admin@example.com',
    );
  });

  it.each([
    [undefined],
    [{}],
    [{ email: 'no-es-correo', password: 'x' }],
    [{ email: 'a@b.co', password: '' }],
    [{ email: 'a@b.co' }],
    [{ email: 123, password: 'x' }],
  ])('rechaza %o con ValidationError', (body) => {
    expect(() => parseWith(loginSchema, body)).toThrow(ValidationError);
  });

  it('el mensaje indica qué campo falla', () => {
    expect(() => parseWith(loginSchema, { email: 'no-es-correo', password: 'x' })).toThrow(/email/);
  });
});

describe('UsersService.ensureAdmin (seed)', () => {
  const hasher: PasswordHasher = {
    hash: vi.fn(async (p) => `hash:${p}`),
    verify: vi.fn(async () => true),
  };

  it('guarda el hash, nunca la contraseña, con rol ADMIN y el correo en minúsculas', async () => {
    const insertIfAbsent = vi.fn(async () => true);
    const service = createUsersService({ users: { insertIfAbsent }, hasher });

    const created = await service.ensureAdmin({
      email: 'Admin@Example.com',
      password: 'Clave-segura-123',
      name: 'Admin',
    });

    expect(created).toBe(true);
    expect(insertIfAbsent).toHaveBeenCalledWith({
      email: 'admin@example.com',
      passwordHash: 'hash:Clave-segura-123',
      name: 'Admin',
      role: 'ADMIN',
    });
  });

  it('devuelve false si el ADMIN ya existía', async () => {
    const service = createUsersService({ users: { insertIfAbsent: async () => false }, hasher });
    expect(
      await service.ensureAdmin({ email: 'a@b.co', password: 'x'.repeat(12), name: 'A' }),
    ).toBe(false);
  });
});
