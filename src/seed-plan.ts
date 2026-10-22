import { z } from 'zod';
import { DEMO_ROLES, DEMO_WAREHOUSES, type SeedPlan, type SeedUser } from './services/seed';

/** Contraseñas de desarrollo de `.env.example`: en producción no se aceptan. */
export const DEV_PASSWORDS: ReadonlySet<string> = new Set([
  'Admin-dev-2026!',
  'Jefe-dev-2026!',
  'Operario-dev-2026!',
  'Auditor-dev-2026!',
]);

const password = z.string().min(12, 'debe tener al menos 12 caracteres');

const adminEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SEED_ADMIN_EMAIL: z.email(),
  SEED_ADMIN_PASSWORD: password,
  SEED_ADMIN_NAME: z.string().min(1).default('Administrador'),
});

const demoEnvSchema = z.object({ email: z.email(), password });

/**
 * Arma lo que se siembra a partir de las variables de entorno. El ADMIN es obligatorio; el jefe de
 * bodega, el operario y el auditor se siembran si se define su correo y su contraseña (en
 * desarrollo vienen de `.env`; en producción, de las variables del entorno de despliegue).
 * Lanza un Error legible si algo falta o es inválido.
 */
export function buildSeedPlan(env: NodeJS.ProcessEnv): SeedPlan {
  const admin = adminEnvSchema.safeParse(env);
  if (!admin.success) {
    throw new Error(describe(admin.error));
  }
  const production = admin.data.NODE_ENV === 'production';

  const users: SeedUser[] = [
    {
      email: admin.data.SEED_ADMIN_EMAIL,
      password: admin.data.SEED_ADMIN_PASSWORD,
      name: admin.data.SEED_ADMIN_NAME,
      role: 'ADMIN',
      warehouseCodes: [],
    },
  ];

  for (const demo of DEMO_ROLES) {
    const email = env[`${demo.envPrefix}_EMAIL`];
    const pass = env[`${demo.envPrefix}_PASSWORD`];
    if (!email && !pass) continue;
    const parsed = demoEnvSchema.safeParse({ email, password: pass });
    if (!parsed.success) {
      throw new Error(`${demo.envPrefix}: ${describe(parsed.error)}`);
    }
    const name = env[`${demo.envPrefix}_NAME`] || demo.name;
    users.push({
      email: parsed.data.email,
      password: parsed.data.password,
      name,
      role: demo.role,
      warehouseCodes: demo.warehouseCodes,
    });
  }

  if (production) {
    const withDevPassword = users.filter((u) => DEV_PASSWORDS.has(u.password));
    if (withDevPassword.length > 0) {
      throw new Error(
        `En producción no se pueden usar contraseñas de desarrollo (${withDevPassword
          .map((u) => u.email)
          .join(', ')})`,
      );
    }
  }

  // Las bodegas de ejemplo solo se crean si hay usuarios de demo que las usen
  const warehouses = users.length > 1 ? DEMO_WAREHOUSES : [];
  return { warehouses, users };
}

function describe(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ');
}
