import argon2 from 'argon2';
import type { PasswordHasher } from './auth';

/** Argon2id con los parámetros por defecto de la librería (recomendados por OWASP). */
export function createArgon2Hasher(): PasswordHasher {
  return {
    hash: (password) => argon2.hash(password, { type: argon2.argon2id }),
    async verify(hash, password) {
      try {
        return await argon2.verify(hash, password);
      } catch {
        // Un hash malformado en la BD cuenta como contraseña incorrecta, no como error del servidor
        return false;
      }
    },
  };
}
