import { setTimeout as sleepFor } from 'node:timers/promises';
import { Pool, type PoolClient } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/** Lo que `withTransaction` necesita del cliente (así se puede probar con uno simulado). */
export interface TransactionClient {
  query(sql: string): Promise<unknown>;
  release(destroy?: boolean): void;
}

/** Códigos de PostgreSQL que se reintentan: fallo de serialización y deadlock detectado. */
const RETRYABLE_CODES: readonly string[] = ['40001', '40P01'];
/** Reintentos tras el primer intento, con espera creciente (50, 100 y 200 ms más algo de azar). */
const RETRY_BASE_DELAYS_MS: readonly number[] = [50, 100, 200];

export interface RetryEvent {
  /** Número del reintento que está por ejecutarse (1, 2 o 3). */
  attempt: number;
  code: string;
  delayMs: number;
}

export interface TransactionOptions {
  /** Se llama antes de cada reintento (sirve para registrarlo en el log). */
  onRetry?: (event: RetryEvent) => void;
  /** Espera entre reintentos; las pruebas la reemplazan para no esperar de verdad. */
  sleep?: (ms: number) => Promise<void>;
}

function retryableCode(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || !('code' in err)) return null;
  const code = err.code;
  return typeof code === 'string' && RETRYABLE_CODES.includes(code) ? code : null;
}

async function runOnce<T, C extends TransactionClient>(
  pool: { connect(): Promise<C> },
  work: (client: C) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Si el ROLLBACK falla la conexión quedó rota: se descarta en vez de devolverla al pool
      client.release(true);
      throw err;
    }
    client.release();
    throw err;
  }
}

/**
 * Ejecuta `work` dentro de una transacción: COMMIT si termina bien, ROLLBACK si lanza un error
 * (que se vuelve a lanzar). El cliente siempre se devuelve al pool.
 *
 * Ante un fallo de serialización (40001) o un deadlock (40P01) repite la transacción completa,
 * hasta 3 veces y con espera creciente; así un deadlock esporádico no llega al usuario como 500.
 * Cualquier otro error se propaga de inmediato. Por eso `work` no debe tener efectos fuera de la BD.
 */
export async function withTransaction<T, C extends TransactionClient = PoolClient>(
  pool: { connect(): Promise<C> },
  work: (client: C) => Promise<T>,
  { onRetry, sleep = (ms) => sleepFor(ms) }: TransactionOptions = {},
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await runOnce(pool, work);
    } catch (err) {
      const code = retryableCode(err);
      const base = RETRY_BASE_DELAYS_MS[attempt];
      if (code === null || base === undefined) throw err;
      const delayMs = base + Math.floor(Math.random() * (base / 2));
      onRetry?.({ attempt: attempt + 1, code, delayMs });
      await sleep(delayMs);
    }
  }
}

/** Ejecutor de transacciones ya ligado a un pool y a su registro de reintentos. */
export function createTransactionRunner(
  pool: Pool,
  onRetry?: (event: RetryEvent) => void,
): <T>(work: (client: PoolClient) => Promise<T>) => Promise<T> {
  return (work) => withTransaction(pool, work, { onRetry });
}
