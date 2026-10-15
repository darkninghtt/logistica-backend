import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../src/domain/errors';
import { createArgon2Hasher } from '../../src/services/password-hasher';
import { createTokenService } from '../../src/services/token-service';

const SECRET = 'un-secreto-de-prueba-de-al-menos-32-caracteres';

describe('hasher Argon2id', () => {
  const hasher = createArgon2Hasher();

  it('genera un hash argon2id distinto de la contraseña, con sal distinta cada vez', async () => {
    const a = await hasher.hash('Clave-segura-123');
    const b = await hasher.hash('Clave-segura-123');
    expect(a).toMatch(/^\$argon2id\$/);
    expect(a).not.toContain('Clave-segura-123');
    expect(a).not.toBe(b);
  });

  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const hash = await hasher.hash('Clave-segura-123');
    expect(await hasher.verify(hash, 'Clave-segura-123')).toBe(true);
    expect(await hasher.verify(hash, 'otra-clave')).toBe(false);
  });

  it('un hash malformado cuenta como contraseña incorrecta, no como error', async () => {
    expect(await hasher.verify('esto-no-es-un-hash', 'cualquiera')).toBe(false);
  });
});

describe('servicio de tokens', () => {
  const tokens = createTokenService({ secret: SECRET, expiresInSeconds: 900 });

  it('un token firmado se verifica y devuelve la identidad', () => {
    const token = tokens.sign({ userId: 'u-1', role: 'ADMIN' });
    expect(tokens.verify(token)).toEqual({ userId: 'u-1', role: 'ADMIN' });
  });

  it('el token expira (dura lo configurado)', () => {
    const token = tokens.sign({ userId: 'u-1', role: 'ADMIN' });
    const payload = jwt.decode(token);
    expect(typeof payload === 'object' && payload !== null && payload.exp! - payload.iat!).toBe(
      900,
    );
  });

  it('rechaza un token expirado', () => {
    const expired = jwt.sign({ role: 'ADMIN' }, SECRET, {
      subject: 'u-1',
      expiresIn: -10,
      algorithm: 'HS256',
    });
    expect(() => tokens.verify(expired)).toThrow(UnauthorizedError);
  });

  it('rechaza un token firmado con otro secreto', () => {
    const other = createTokenService({
      secret: 'otro-secreto-distinto-de-32-caracteres-o-mas',
      expiresInSeconds: 900,
    });
    expect(() => tokens.verify(other.sign({ userId: 'u-1', role: 'ADMIN' }))).toThrow(
      UnauthorizedError,
    );
  });

  it('rechaza un token sin firma (alg none) y basura', () => {
    const none = jwt.sign({ role: 'ADMIN' }, '', { subject: 'u-1', algorithm: 'none' });
    expect(() => tokens.verify(none)).toThrow(UnauthorizedError);
    expect(() => tokens.verify('basura')).toThrow(UnauthorizedError);
  });

  it('rechaza un token con un rol que no existe', () => {
    const bad = jwt.sign({ role: 'SUPERMAN' }, SECRET, { subject: 'u-1', algorithm: 'HS256' });
    expect(() => tokens.verify(bad)).toThrow(UnauthorizedError);
  });
});
