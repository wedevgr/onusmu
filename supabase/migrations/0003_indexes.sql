-- 0003_indexes.sql
-- Indexes for the app's hot query paths:
-- - per-user, time-ordered listings of chunks and sessions
-- - job queue polling by status + next attempt time
-- - chat history per conversation
-- - HNSW approximate nearest neighbor search on embeddings (cosine distance)
-- - GIN trigram index for substring/fuzzy text search

create index if not exists transcript_chunks_user_started_idx
  on public.transcript_chunks (user_id, started_at desc);

create index if not exists transcript_chunks_session_idx
  on public.transcript_chunks (session_id);

create index if not exists recording_sessions_user_started_idx
  on public.recording_sessions (user_id, started_at desc);

create index if not exists audio_jobs_poll_idx
  on public.audio_jobs (status, next_attempt_at);

create index if not exists chat_messages_conversation_idx
  on public.chat_messages (conversation_id, created_at);

create index if not exists transcript_chunks_embedding_idx
  on public.transcript_chunks using hnsw (embedding vector_cosine_ops);

create index if not exists transcript_chunks_text_trgm_idx
  on public.transcript_chunks using gin (text gin_trgm_ops);
