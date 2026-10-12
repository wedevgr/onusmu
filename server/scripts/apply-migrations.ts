import { promises as fs } from 'fs';
import path from 'path';
import { Client } from 'pg';
import { config } from '../src/config';
import { dbSsl } from '../src/lib/dbssl';

/**
 * Applies supabase/migrations/*.sql to the database configured in DATABASE_URL,
 * in filename order, one transaction per migration. Idempotent migrations can
 * be re-run safely.
 */
async function main(): Promise<void> {
  const dir = path.resolve(__dirname, '../../supabase/migrations');
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) throw new Error(`No migration files found in ${dir}`);

  const client = new Client({
    connectionString: config.DATABASE_URL,
    ssl: dbSsl(),
  });
  await client.connect();

  try {
    for (const file of files) {
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('COMMIT');
        console.log('ok');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  console.log(`Applied ${files.length} migration(s).`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
