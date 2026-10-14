import { query, queryOne } from '../db';
import { ctx, encryptText } from '../lib/crypto';
import { suggestRemindersFromChunk } from '../lib/reminders';
import { downloadAudio, removeAudio } from '../lib/storage';
import { getEmbeddingProvider, getSttProvider } from '../providers';
import type { AudioJob } from './jobs';
import { completeJob, failJob } from './jobs';

interface ChunkRow {
  id: string;
  user_id: string;
  session_id: string;
  started_at: Date;
  audio_path: string | null;
  processing_status: string;
}

/**
 * Pipeline for one chunk: transcribing -> (text) -> embedding -> completed.
 * Audio is deleted after completion unless the user enabled retention.
 * Any thrown error is caught by the worker and schedules a retry; the audio
 * file is kept until the chunk completes, so nothing is lost silently.
 */
export async function processChunkJob(job: AudioJob): Promise<void> {
  const chunk = await queryOne<ChunkRow>(
    `SELECT id, user_id, session_id, started_at, audio_path, processing_status
     FROM transcript_chunks WHERE id = $1`,
    [job.chunk_id],
  );
  if (!chunk) throw new Error(`Chunk ${job.chunk_id} not found`);
  if (chunk.processing_status === 'completed') {
    await completeJob(job.id);
    return;
  }
  if (!chunk.audio_path) throw new Error('Chunk has no audio stored');

  await query(`UPDATE transcript_chunks SET processing_status = 'transcribing' WHERE id = $1`, [
    chunk.id,
  ]);

  const audio = await downloadAudio(chunk.audio_path);
  const text = await getSttProvider().transcribe(audio, chunk.audio_path.split('/').pop() ?? 'chunk.m4a');

  if (!text) {
    // Silence / no speech: complete without embedding, still respect retention.
    await query(
      `UPDATE transcript_chunks SET text = '', processing_status = 'completed' WHERE id = $1`,
      [chunk.id],
    );
    await maybeDeleteAudio(chunk);
    await completeJob(job.id);
    return;
  }

  await query(
    `UPDATE transcript_chunks SET text = $2, processing_status = 'embedding' WHERE id = $1`,
    [chunk.id, encryptText(text, ctx.chunkText(chunk.user_id, chunk.id))],
  );

  const [embedding] = await getEmbeddingProvider().embed([text]);
  const vector = `[${embedding.join(',')}]`;
  await query(
    `UPDATE transcript_chunks SET embedding = $2::vector, processing_status = 'completed' WHERE id = $1`,
    [chunk.id, vector],
  );

  // Suggestions are extra: a failure here must not retry (and re-bill) the transcription.
  try {
    await suggestRemindersFromChunk(chunk, text);
  } catch (err) {
    console.error('[reminders] suggestion failed for chunk', chunk.id, err instanceof Error ? err.message : err);
  }

  await maybeDeleteAudio(chunk);
  await completeJob(job.id);
}

async function maybeDeleteAudio(chunk: ChunkRow): Promise<void> {
  if (!chunk.audio_path) return;
  const settings = await queryOne<{ keep_audio: boolean }>(
    `SELECT keep_audio FROM user_settings WHERE user_id = $1`,
    [chunk.user_id],
  );
  const keepAudio = settings?.keep_audio ?? false;
  if (!keepAudio) {
    await removeAudio(chunk.audio_path);
    await query(`UPDATE transcript_chunks SET audio_path = NULL WHERE id = $1`, [chunk.id]);
  }
}
