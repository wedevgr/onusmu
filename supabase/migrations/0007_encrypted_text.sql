-- 0007_encrypted_text.sql
-- transcript_chunks.text is now stored encrypted by the backend (AES-256-GCM, 'enc:v1:' prefix),
-- so Postgres can no longer match or rank on its contents:
-- - the trigram index and search_chunks_text() are dropped (text search runs in the backend
--   after decryption)
-- - match_chunks() becomes pure vector similarity and returns the stored (encrypted) text;
--   the backend decrypts and applies the keyword part of the hybrid score.
-- Empty text ('') is left as-is and still means "no speech".

drop index if exists public.transcript_chunks_text_trgm_idx;

drop function if exists public.search_chunks_text(uuid, text, timestamptz, timestamptz, integer);

drop function if exists public.match_chunks(uuid, vector, text, timestamptz, timestamptz, integer);
drop function if exists public.match_chunks(uuid, vector, timestamptz, timestamptz, integer);
create function public.match_chunks(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 36
)
returns table (
  id uuid,
  session_id uuid,
  text text,
  started_at timestamptz,
  ended_at timestamptz,
  score float
)
language sql
stable
security invoker
as $$
  select
    c.id,
    c.session_id,
    c.text,
    c.started_at,
    c.ended_at,
    (1 - (c.embedding <=> p_query_embedding))::float as score
  from public.transcript_chunks as c
  where c.user_id = p_user_id
    and (p_user_id = auth.uid() or auth.uid() is null)  -- allows backend (postgres role: auth.uid() null) and user JWTs
    and c.embedding is not null         -- exclude rows not yet embedded
    and c.text <> ''
    and (p_from is null or c.started_at >= p_from)
    and (p_to is null or c.started_at <= p_to)
  order by c.embedding <=> p_query_embedding
  limit p_limit;
$$;
