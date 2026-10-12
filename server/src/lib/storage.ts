import { AUDIO_BUCKET } from '../config';
import { supabaseService } from '../supabase';
import { ctx, decryptBuffer, encryptBuffer } from './crypto';

/** Audio is encrypted before it leaves the server, so the bucket only ever holds ciphertext. */
export async function uploadAudio(path: string, buffer: Buffer): Promise<void> {
  const { error } = await supabaseService.storage
    .from(AUDIO_BUCKET)
    .upload(path, encryptBuffer(buffer, ctx.audio(path)), { contentType: 'application/octet-stream', upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function downloadRawAudio(path: string): Promise<Buffer> {
  const { data, error } = await supabaseService.storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'empty'}`);
  return Buffer.from(await data.arrayBuffer());
}

export async function downloadAudio(path: string): Promise<Buffer> {
  return decryptBuffer(await downloadRawAudio(path), ctx.audio(path));
}

export async function removeAudio(path: string): Promise<void> {
  await supabaseService.storage.from(AUDIO_BUCKET).remove([path]);
}

export async function removeUserAudioPrefix(userId: string): Promise<void> {
  const prefix = `${userId}/`;
  const { data: files, error } = await supabaseService.storage.from(AUDIO_BUCKET).list(prefix, {
    limit: 1000,
  });
  if (error || !files || files.length === 0) return;
  const paths = files
    .filter((f) => f.name.length > 0)
    .map((f) => `${prefix}${f.name}`);
  if (paths.length > 0) {
    await supabaseService.storage.from(AUDIO_BUCKET).remove(paths);
  }
}
