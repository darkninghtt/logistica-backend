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
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof envSchema>;

/** Valida las variables de entorno al arrancar; si alguna es inválida, lanza un error legible. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Variables de entorno inválidas: ${problems}`);
  }
  return result.data;
}
