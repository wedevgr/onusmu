import { query } from '../src/db';
import { config } from '../src/config';
import { ctx, decryptText } from '../src/lib/crypto';
import { getEmbeddingProvider } from '../src/providers';

/**
 * Re-embeds every transcript with the configured EMBEDDING_MODEL. Needed after changing the
 * model: questions and stored transcripts must use the same one, or search returns noise.
 * Run it right after the server with the new model is deployed:
 *   EMBEDDING_MODEL=text-embedding-3-large npm run reembed
 */
const BATCH = 64;

async function main(): Promise<void> {
  const rows = await query<{ id: string; user_id: string; text: string }>(
    `SELECT id, user_id, text FROM transcript_chunks WHERE text <> '' ORDER BY created_at`,
  );
  console.log(`Re-embedding ${rows.length} transcripts with ${config.EMBEDDING_MODEL}...`);
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const vectors = await getEmbeddingProvider().embed(
      batch.map((r) => decryptText(r.text, ctx.chunkText(r.user_id, r.id))),
    );
    for (const [j, row] of batch.entries()) {
      await query(`UPDATE transcript_chunks SET embedding = $2::vector WHERE id = $1`, [
        row.id,
        `[${vectors[j]!.join(',')}]`,
      ]);
    }
    console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
