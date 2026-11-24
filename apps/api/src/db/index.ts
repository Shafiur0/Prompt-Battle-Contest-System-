import { Pool, PoolClient } from 'pg';
import { config } from '../config';
export const pool = new Pool({ connectionString: config.databaseUrl, max: 20, options: '-c search_path=battle' });
export async function transaction<T>(action: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await action(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
export async function audit(db: PoolClient, competitionId: string, actorId: string | null, type: string, payload: unknown) {
  await db.query('SELECT append_audit($1,$2,$3,$4::jsonb)', [competitionId, actorId, type, JSON.stringify(payload)]);
}
export async function enqueue(db: PoolClient, kind: string, key: string, payload: unknown) {
  await db.query('INSERT INTO outbox_jobs(kind,logical_key,payload) VALUES($1,$2,$3) ON CONFLICT(kind,logical_key) DO NOTHING',
    [kind, key, JSON.stringify(payload)]);
}
