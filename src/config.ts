import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1, 'es obligatoria'),
  JWT_SECRET: z.string().min(32, 'debe tener al menos 32 caracteres'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  // Saltos de proxy de confianza (en Render: 1). Sin esto todas las peticiones parecen venir de la misma IP.
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  // Carpeta con el build del frontend; si no tiene index.html, no se sirve nada
  PUBLIC_DIR: z.string().min(1).default('public'),
  // Duración del refresh token (7 días)
  REFRESH_TTL_SECONDS: z.coerce.number().int().min(60).default(604800),
  // La cookie del refresh lleva `Secure` (solo HTTPS). Por defecto: sí en producción, no en local.
  COOKIE_SECURE: z.stringbool().optional(),
  // Rate limiting por IP: general sobre /api y estricto (intentos fallidos) en login y refresh
  RATE_LIMIT_GENERAL_MAX: z.coerce.number().int().min(1).default(300),
  RATE_LIMIT_GENERAL_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).default(10),
  RATE_LIMIT_AUTH_WINDOW_SECONDS: z.coerce.number().int().min(1).default(900),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & { COOKIE_SECURE: boolean };

/** Valida las variables de entorno al arrancar; si alguna es inválida, lanza un error legible. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Variables de entorno inválidas: ${problems}`);
  }
  const { COOKIE_SECURE, ...rest } = result.data;
  return { ...rest, COOKIE_SECURE: COOKIE_SECURE ?? rest.NODE_ENV === 'production' };
}
