import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { UnauthorizedError } from '../domain/errors';
import { roleSchema } from '../domain/user';
import type { AuthIdentity, TokenService } from './auth';

export interface TokenConfig {
  secret: string;
  expiresInSeconds: number;
}

const ALGORITHM = 'HS256';

// Forma del contenido del JWT: `sub` es el id del usuario
const payloadSchema = z.object({ sub: z.string().min(1), role: roleSchema });

export function createTokenService({ secret, expiresInSeconds }: TokenConfig): TokenService {
  return {
    sign({ userId, role }) {
      return jwt.sign({ role }, secret, {
        algorithm: ALGORITHM,
        subject: userId,
        expiresIn: expiresInSeconds,
      });
    },

    verify(token): AuthIdentity {
      try {
        // Se fija el algoritmo para impedir tokens "alg: none" o firmados con otro algoritmo
        const decoded = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
        const payload = payloadSchema.parse(decoded);
        return { userId: payload.sub, role: payload.role };
      } catch {
        throw new UnauthorizedError('Token inválido o expirado');
      }
    },
  };
}
