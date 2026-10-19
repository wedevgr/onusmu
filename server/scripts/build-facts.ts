import { query } from '../src/db';
import { ctx, decryptText } from '../src/lib/crypto';
import { understandChunk } from '../src/lib/understand';

/**
 * Reads each user's existing transcripts, oldest first, the way new recordings are read: facts
 * (expenses, debts, money owed to them, readings) and tasks they said are done.
 * With --with-tasks it also creates tasks from notes that never produced any (recorded before
 * reminders existed); a note that already has reminders, even dismissed ones, gets none again.
 * Transcripts are never changed. Run once after migration 0012:
 *   npm run facts:build -- [--dry-run] [--with-tasks] [<user_id>]
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const withTasks = process.argv.includes('--with-tasks');
  const only = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const chunks = await query<{ id: string; user_id: string; session_id: string; started_at: Date; text: string }>(
    `SELECT id, user_id, session_id, started_at, text FROM transcript_chunks
     WHERE text <> '' AND ($1::uuid IS NULL OR user_id = $1)
     ORDER BY user_id, started_at`,
    [only ?? null],
  );

  let previous = { session: '', text: '' };
  for (const chunk of chunks) {
    const text = decryptText(chunk.text, ctx.chunkText(chunk.user_id, chunk.id));
    const context = previous.session === chunk.session_id ? previous.text : '';
    previous = { session: chunk.session_id, text };
    try {
      const existing = withTasks
        ? await query(`SELECT 1 FROM reminders WHERE source_chunk_id = $1 LIMIT 1`, [chunk.id])
        : [{}];
      const r = await understandChunk(chunk, text, context, {
        createReminders: existing.length === 0,
        dryRun,
        quiet: true,
      });
      const parts = [
        ...r.facts.map((f) =>
          `${f.kind} ${f.amount ?? f.value ?? ''}${f.currency ?? f.unit ?? ''} ${f.text}${f.paidBy === 'other' ? ' (άλλος)' : ''}`.trim(),
        ),
        ...r.reminders.map((t) => `task: ${t}`),
        ...r.done.map((t) => `done: ${t}`),
        ...r.settled.map((t) => `paid: ${t}`),
      ];
      if (parts.length > 0) console.log(`${chunk.started_at.toISOString().slice(0, 16)} ${text.slice(0, 70)}\n    -> ${parts.join(' | ')}`);
    } catch (err) {
      console.error(`  chunk ${chunk.id}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(dryRun ? '\nDry run: nothing was written.' : '\nDone.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
