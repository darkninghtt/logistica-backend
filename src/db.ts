import { Pool, type PoolClient } from 'pg';

export function createPool(connectionString: string): Pool {
  return new Pool({ connectionString });
}

/**
 * Ejecuta `work` dentro de una transacción: COMMIT si termina bien, ROLLBACK si lanza un error
 * (que se vuelve a lanzar). El cliente siempre se devuelve al pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
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
