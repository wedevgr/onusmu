-- 0002_tables.sql
-- Core tables for the AI Memory app.
-- recording_sessions: one continuous recording period on a device, upserted by (user_id, client_id).
-- transcript_chunks: timestamped transcript segments with embeddings, optionally linked to stored audio.
-- audio_jobs: backend processing queue for transcription/embedding of chunks.
-- user_settings: per-user preferences (keep_audio defaults to false -> audio deleted after transcription).
-- chat_conversations / chat_messages: RAG chat history with citation metadata.

create table if not exists public.recording_sessions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  client_id        text not null,              -- id generated on the device; upsert key is (user_id, client_id)
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_seconds int,
  status           text not null default 'open',  -- 'open' | 'closed'
  created_at       timestamptz not null default now(),
  unique (user_id, client_id)
);

create table if not exists public.transcript_chunks (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  session_id        uuid not null references public.recording_sessions (id) on delete cascade,
  text              text not null default '',
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  embedding         vector(1536),               -- text-embedding-3-small; see README to change dim
  audio_path        text,                       -- storage object path '<user_id>/<chunk_id>.m4a'; null when deleted
  processing_status text not null default 'pending',  -- 'pending'|'transcribing'|'embedding'|'completed'|'failed'
  created_at        timestamptz not null default now()
);

create table if not exists public.audio_jobs (
  id             uuid primary key default gen_random_uuid(),
  chunk_id       uuid not null references public.transcript_chunks (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  status         text not null default 'pending',  -- 'pending'|'processing'|'completed'|'failed'
  attempts       int not null default 0,
  max_attempts   int not null default 8,
  last_error     text,
  next_attempt_at timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  keep_audio boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  title      text not null default 'Conversation',
  created_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  role            text not null,                -- 'user' | 'assistant'
  content         text not null,
  citations       jsonb,                        -- array of {chunkId, sessionId, startedAt, endedAt, text, score}
  created_at      timestamptz not null default now()
);
