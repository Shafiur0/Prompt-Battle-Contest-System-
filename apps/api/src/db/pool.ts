import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  application_name: 'prompt-battle-api'
});

pool.on('error', (error) => {
  console.error('[db] idle client error', error);
});

export type Row = QueryResultRow;

export interface Db {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: unknown[]): Promise<T | null>;
  must<T extends Row = Row>(text: string, params?: unknown[]): Promise<T>;
}

function wrap(client: Pool | PoolClient): Db {
  return {
    async query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
      const result = await client.query<T>(text, params);
      return result.rows;
    },
    async one<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
      const result = await client.query<T>(text, params);
      return result.rows[0] ?? null;
    },
    async must<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T> {
      const result = await client.query<T>(text, params);
      const row = result.rows[0];
      if (!row) throw new Error(`Expected a row from query: ${text.slice(0, 80)}`);
      return row;
    }
  };
}

export const db: Db = wrap(pool);

export class TxError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown
  ) {
    super(message);
  }
}

/**
 * Runs `fn` inside a single database transaction with a fixed lock order.
 * Never perform a provider or sandbox call inside this callback: a remote call
 * cannot be committed atomically with the local row (architecture s.7).
 */
export async function withTransaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query("set local lock_timeout = '5s'");
    const result = await fn(wrap(client));
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the transaction is already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}
