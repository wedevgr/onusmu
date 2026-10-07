import { AUDIO_BUCKET } from '../config';
import { supabaseService } from '../supabase';

export async function uploadAudio(path: string, buffer: Buffer): Promise<void> {
  const { error } = await supabaseService.storage
    .from(AUDIO_BUCKET)
    .upload(path, buffer, { contentType: 'audio/m4a', upsert: true });
  if (error) throw new Error(`Storage upload failed: ${error.message}`);
}

export async function downloadAudio(path: string): Promise<Buffer> {
  const { data, error } = await supabaseService.storage.from(AUDIO_BUCKET).download(path);
  if (error || !data) throw new Error(`Storage download failed: ${error?.message ?? 'empty'}`);
  return Buffer.from(await data.arrayBuffer());
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

export async function signedAudioUrl(path: string, expiresSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabaseService.storage
    .from(AUDIO_BUCKET)
    .createSignedUrl(path, expiresSeconds);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
