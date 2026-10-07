-- 0006_storage.sql
-- Private storage bucket for raw audio chunks.
-- Objects are stored under a folder named with the owning user's id:
--   audio-chunks/<user_id>/<chunk_id>.m4a
-- transcript_chunks.audio_path mirrors this object path and is set to NULL
-- when audio is deleted (default when user_settings.keep_audio = false).
--
-- NOTE: storage.objects is owned by supabase_storage_admin on hosted Supabase,
-- so per-user storage policies cannot be created via SQL migrations with the
-- postgres role. This is fine for this architecture: ALL storage access goes
-- through the backend with the service-role key (which bypasses Storage RLS),
-- and audio is never exposed to clients directly. If you later need direct
-- client access to audio, create these policies from the Dashboard instead:
--   for select/insert/update/delete to authenticated
--   using (bucket_id = 'audio-chunks' and (storage.foldername(name))[1] = auth.uid()::text)

insert into storage.buckets (id, name, public)
values ('audio-chunks', 'audio-chunks', false)
on conflict (id) do nothing;
