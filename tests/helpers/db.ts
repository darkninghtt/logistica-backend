import { Pool } from 'pg';

/** Carga `.env` si existe (en CI las variables ya vienen del entorno). */
function loadEnvFile(): void {
  try {
    process.loadEnvFile('.env');
  } catch {
    // sin .env: se usan las variables del entorno
  }
}

/** URL de la BD de pruebas. Se niega a usar la BD de desarrollo para no borrar datos reales. */
export function getTestDatabaseUrl(): string {
  loadEnvFile();
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error('Falta TEST_DATABASE_URL (ver .env.example)');
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error('TEST_DATABASE_URL no puede ser igual a DATABASE_URL');
  }
  return url;
}

export function createTestPool(): Pool {
  return new Pool({ connectionString: getTestDatabaseUrl() });
}

/** Aplica (up) o revierte (down) las migraciones sobre la BD de pruebas. */
export async function migrateTestDatabase(direction: 'up' | 'down'): Promise<void> {
  // node-pg-migrate es solo ESM, por eso se importa de forma dinámica
  const { runner } = await import('node-pg-migrate');
  await runner({
    databaseUrl: getTestDatabaseUrl(),
    dir: 'migrations',
    direction,
    count: direction === 'down' ? Infinity : undefined,
    migrationsTable: 'pgmigrations',
    log: () => undefined,
  });
}

/** Deja la BD de pruebas sin datos (las tablas se mantienen). */
export async function truncateAll(pool: Pool): Promise<void> {
  await pool.query('TRUNCATE users');
}
