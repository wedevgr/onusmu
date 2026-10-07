import { pool, query } from '../db';

export interface AudioJob {
  id: string;
  chunk_id: string;
  user_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_attempt_at: string;
}

export async function enqueueJob(chunkId: string, userId: string): Promise<void> {
  await query(
    `INSERT INTO audio_jobs (chunk_id, user_id) VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [chunkId, userId],
  );
}

/**
 * Atomically claims up to `limit` due jobs. Attempts are incremented at
 * pickup time; failJob uses attempts >= max_attempts to mark permanent failure.
 */
export async function claimNextJobs(limit = 5): Promise<AudioJob[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<AudioJob>(
      `UPDATE audio_jobs
       SET status = 'processing', attempts = attempts + 1, updated_at = now()
       WHERE id IN (
         SELECT id FROM audio_jobs
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       RETURNING *`,
      [limit],
    );
    await client.query('COMMIT');
    return res.rows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function completeJob(jobId: string): Promise<void> {
  await query(
    `UPDATE audio_jobs SET status = 'completed', last_error = NULL, updated_at = now() WHERE id = $1`,
    [jobId],
  );
}

/** Backoff: 5s * 2^attempts, capped at 15 minutes. */
export async function failJob(job: AudioJob, errorMessage: string): Promise<void> {
  const attempts = job.attempts;
  const maxAttempts = job.max_attempts;
  const permanent = attempts >= maxAttempts;
  const delayMs = Math.min(5000 * 2 ** Math.max(0, attempts - 1), 15 * 60 * 1000);
  await query(
    `UPDATE audio_jobs
     SET status = $2, last_error = $3, updated_at = now(),
         next_attempt_at = now() + ($4 || ' milliseconds')::interval
     WHERE id = $1`,
    [job.id, permanent ? 'failed' : 'pending', errorMessage.slice(0, 2000), String(delayMs)],
  );
}

/** Jobs interrupted mid-processing (crash/redeploy) go back to the queue. */
export async function recoverStaleJobs(): Promise<void> {
  await query(
    `UPDATE audio_jobs SET status = 'pending', updated_at = now()
     WHERE status = 'processing' AND updated_at < now() - interval '10 minutes'`,
  );
}
