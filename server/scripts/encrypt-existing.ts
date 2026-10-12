import { Client } from 'pg';
import { AUDIO_BUCKET, config } from '../src/config';
import {
  ACTIVE_TEXT_PREFIX,
  ctx,
  decryptBuffer,
  decryptText,
  encryptBuffer,
  encryptText,
  isCurrentBuffer,
  isCurrentText,
} from '../src/lib/crypto';
import { dbSsl } from '../src/lib/dbssl';
import type { Citation } from '../src/lib/rag';
import { downloadRawAudio } from '../src/lib/storage';
import { supabaseService } from '../src/supabase';

const CURRENT = `${ACTIVE_TEXT_PREFIX}%`;
const LEGACY = { allowLegacy: true };

/**
 * Brings every stored value up to the current encryption format and key:
 * conversation titles, message content, citation text, transcript chunk text
 * and stored audio files.
 *
 * Handles plaintext, the old unbound format, and values encrypted with a
 * previous key, so the same script serves the first migration and every key
 * rotation. Idempotent: values already on the active key are skipped.
 */
async function main(): Promise<void> {
  const client = new Client({ connectionString: config.DATABASE_URL, ssl: dbSsl() });
  await client.connect();

  try {
    const conversations = await client.query<{ id: string; user_id: string; title: string }>(
      `SELECT id, user_id, title FROM chat_conversations WHERE title NOT LIKE $1`,
      [CURRENT],
    );
    for (const c of conversations.rows) {
      const context = ctx.conversationTitle(c.user_id, c.id);
      await client.query(`UPDATE chat_conversations SET title = $1 WHERE id = $2`, [
        encryptText(decryptText(c.title, context, LEGACY), context),
        c.id,
      ]);
    }
    console.log(`Upgraded ${conversations.rowCount ?? 0} conversation title(s).`);

    const messages = await client.query<{
      id: string;
      user_id: string;
      content: string;
      citations: Citation[] | null;
    }>(
      `SELECT id, user_id, content, citations FROM chat_messages
       WHERE content NOT LIKE $1
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements(COALESCE(citations, '[]'::jsonb)) el
            WHERE el->>'text' NOT LIKE $1
          )`,
      [CURRENT],
    );
    for (const m of messages.rows) {
      const contentCtx = ctx.messageContent(m.user_id, m.id);
      const citationCtx = ctx.messageCitation(m.user_id, m.id);
      const content = isCurrentText(m.content)
        ? m.content
        : encryptText(decryptText(m.content, contentCtx, LEGACY), contentCtx);
      const citations =
        m.citations === null
          ? null
          : JSON.stringify(
              m.citations.map((c) => ({
                ...c,
                text: isCurrentText(c.text)
                  ? c.text
                  : encryptText(decryptText(c.text, citationCtx, LEGACY), citationCtx),
              })),
            );
      await client.query(
        `UPDATE chat_messages SET content = $1, citations = $2::jsonb WHERE id = $3`,
        [content, citations, m.id],
      );
    }
    console.log(`Upgraded ${messages.rowCount ?? 0} message(s).`);

    // Empty text means "no speech" and stays empty.
    const chunks = await client.query<{ id: string; user_id: string; text: string }>(
      `SELECT id, user_id, text FROM transcript_chunks WHERE text <> '' AND text NOT LIKE $1`,
      [CURRENT],
    );
    for (const c of chunks.rows) {
      const context = ctx.chunkText(c.user_id, c.id);
      await client.query(`UPDATE transcript_chunks SET text = $1 WHERE id = $2`, [
        encryptText(decryptText(c.text, context, LEGACY), context),
        c.id,
      ]);
    }
    console.log(`Upgraded ${chunks.rowCount ?? 0} transcript chunk(s).`);

    const audio = await client.query<{ audio_path: string }>(
      `SELECT audio_path FROM transcript_chunks WHERE audio_path IS NOT NULL`,
    );
    let audioUpgraded = 0;
    let audioFailed = 0;
    for (const a of audio.rows) {
      try {
        const raw = await downloadRawAudio(a.audio_path);
        if (isCurrentBuffer(raw)) continue;
        const context = ctx.audio(a.audio_path);
        const { error } = await supabaseService.storage
          .from(AUDIO_BUCKET)
          .upload(a.audio_path, encryptBuffer(decryptBuffer(raw, context, LEGACY), context), {
            contentType: 'application/octet-stream',
            upsert: true,
          });
        if (error) throw new Error(error.message);
        audioUpgraded += 1;
      } catch (err) {
        audioFailed += 1;
        console.error(`Audio ${a.audio_path}: ${err instanceof Error ? err.message : err}`);
      }
    }
    console.log(`Upgraded ${audioUpgraded} audio file(s), ${audioFailed} failed.`);

    const remaining = await client.query<{ n: string }>(
      `SELECT (SELECT COUNT(*) FROM chat_conversations WHERE title NOT LIKE $1)
            + (SELECT COUNT(*) FROM chat_messages WHERE content NOT LIKE $1)
            + (SELECT COUNT(*) FROM chat_messages m WHERE EXISTS (
                 SELECT 1 FROM jsonb_array_elements(COALESCE(m.citations, '[]'::jsonb)) el
                 WHERE el->>'text' NOT LIKE $1) AND m.content LIKE $1)
            + (SELECT COUNT(*) FROM transcript_chunks WHERE text <> '' AND text NOT LIKE $1) AS n`,
      [CURRENT],
    );
    const left = Number(remaining.rows[0]?.n ?? NaN) + audioFailed;
    console.log(`Values not on the active key: ${Number.isNaN(left) ? '?' : left}`);
    if (left === 0) {
      console.log(
        'Everything is on the current format and key. You can now set ENCRYPTION_REJECT_LEGACY=true ' +
          'and remove any retired keys from ENCRYPTION_KEYS.',
      );
    }
  } finally {
    await client.end();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
