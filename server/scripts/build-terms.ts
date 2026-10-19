import { query } from '../src/db';
import { ctx, decryptText } from '../src/lib/crypto';
import { loadTerms, recordTerms, reviseTranscript } from '../src/lib/glossary';

/**
 * Builds each user's vocabulary (user_terms) from the transcripts they already have, oldest
 * first, the way new recordings build it. Transcripts are read, never changed.
 * Run once after migration 0011: npm run terms:build [-- <user_id>]
 */
async function main(): Promise<void> {
  const only = process.argv[2];
  const users = await query<{ user_id: string }>(
    `SELECT DISTINCT user_id FROM transcript_chunks
     WHERE text <> '' AND ($1::uuid IS NULL OR user_id = $1)`,
    [only ?? null],
  );

  for (const { user_id: userId } of users) {
    const chunks = await query<{ id: string; text: string; session_id: string }>(
      `SELECT id, text, session_id FROM transcript_chunks
       WHERE user_id = $1 AND text <> '' ORDER BY started_at`,
      [userId],
    );
    const terms = await loadTerms(userId);
    let previous = { session: '', text: '' };
    for (const chunk of chunks) {
      const text = decryptText(chunk.text, ctx.chunkText(userId, chunk.id));
      const context = previous.session === chunk.session_id ? previous.text : '';
      try {
        const revision = await reviseTranscript(text, context, terms);
        await recordTerms(userId, revision.terms, terms);
      } catch (err) {
        console.error(`  chunk ${chunk.id}: ${err instanceof Error ? err.message : err}`);
      }
      previous = { session: chunk.session_id, text };
    }
    console.log(`${userId}: ${chunks.length} transcripts read, ${terms.length} names`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
