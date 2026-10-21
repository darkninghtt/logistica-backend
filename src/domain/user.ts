import { z } from 'zod';

export const ROLES = ['ADMIN', 'WAREHOUSE_MANAGER', 'OPERATOR', 'AUDITOR'] as const;
export const roleSchema = z.enum(ROLES);
export type Role = z.infer<typeof roleSchema>;

/** Usuario tal como se guarda (incluye el hash: nunca sale de las capas internas). */
export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  role: Role;
  /** Un usuario desactivado no puede iniciar sesión ni renovar la sesión. */
  active: boolean;
}

/** Datos del usuario que sí pueden viajar al cliente. */
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function toPublicUser(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
