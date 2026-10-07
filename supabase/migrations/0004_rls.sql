-- 0004_rls.sql
-- Row Level Security: every table is scoped to the authenticated user's own rows.
-- Each policy allows SELECT/INSERT/UPDATE/DELETE only when user_id = auth.uid().
-- For user_settings the same rule applies to its primary key column user_id.

alter table public.recording_sessions enable row level security;
alter table public.transcript_chunks enable row level security;
alter table public.audio_jobs enable row level security;
alter table public.user_settings enable row level security;
alter table public.chat_conversations enable row level security;
alter table public.chat_messages enable row level security;

drop policy if exists "recording_sessions owner access" on public.recording_sessions;
create policy "recording_sessions owner access" on public.recording_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "transcript_chunks owner access" on public.transcript_chunks;
create policy "transcript_chunks owner access" on public.transcript_chunks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "audio_jobs owner access" on public.audio_jobs;
create policy "audio_jobs owner access" on public.audio_jobs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "user_settings owner access" on public.user_settings;
create policy "user_settings owner access" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat_conversations owner access" on public.chat_conversations;
create policy "chat_conversations owner access" on public.chat_conversations
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "chat_messages owner access" on public.chat_messages;
create policy "chat_messages owner access" on public.chat_messages
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
