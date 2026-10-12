import { Pool, type QueryResultRow } from 'pg';
import { config } from './config';
import { dbSsl } from './lib/dbssl';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  ssl: dbSsl(),
  max: 10,
  keepAlive: true,
});

// Idle clients in the pool can emit errors (e.g. the Supabase pooler resetting
// long-lived connections). Without this handler those crashes kill the process.
pool.on('error', (err) => {
  console.error('[db] idle pool client error:', err.message);
});

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
