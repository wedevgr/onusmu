-- 0005_functions.sql
-- Search functions used by the RAG chat backend.
-- Both are SECURITY INVOKER (so row-level security applies) and carry an explicit
-- (p_user_id = auth.uid() or auth.uid() is null) guard, so they work both for the
-- backend (direct Postgres connection as the postgres role, where auth.uid() is null)
-- and for clients with a user JWT (an authenticated caller must pass their own uid;
-- anon callers pass the guard but RLS filters out every row).
--
-- match_chunks: hybrid retrieval over transcript_chunks.
--   score = 0.75 * vector_cosine_similarity
--         + 0.25 * ts_rank_cd(full-text rank, normalized to roughly 0..1)
--         + 0.1  exact-substring bonus when p_query is non-empty and appears in text
--   With p_query null/empty the rank terms drop to 0, so ordering is pure vector similarity.
--
-- search_chunks_text: trigram similarity search over transcript chunks.

drop function if exists public.match_chunks(uuid, vector, text, timestamptz, timestamptz, integer);
create function public.match_chunks(
  p_user_id uuid,
  p_query_embedding vector(1536),
  p_query text default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 12
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
    (
      0.75 * (1 - (c.embedding <=> p_query_embedding))
      + 0.25 * coalesce(
          ts_rank_cd(to_tsvector('simple', c.text), plainto_tsquery('simple', p_query)),
          0
        )
      + case
          when p_query is not null and p_query <> '' and c.text ilike '%' || p_query || '%'
          then 0.1
          else 0
        end
    )::float as score
  from public.transcript_chunks as c
  where c.user_id = p_user_id
    and (p_user_id = auth.uid() or auth.uid() is null)  -- allows backend (postgres role: auth.uid() null) and user JWTs
    and c.embedding is not null         -- exclude rows not yet embedded
    and c.text <> ''
    and (p_from is null or c.started_at >= p_from)
    and (p_to is null or c.started_at <= p_to)
  order by score desc
  limit p_limit;
$$;

drop function if exists public.search_chunks_text(uuid, text, timestamptz, timestamptz, integer);
create function public.search_chunks_text(
  p_user_id uuid,
  p_query text,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 50
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
    similarity(c.text, p_query)::float as score
  from public.transcript_chunks as c
  where c.user_id = p_user_id
    and (p_user_id = auth.uid() or auth.uid() is null)  -- allows backend (postgres role: auth.uid() null) and user JWTs
    and c.text ilike '%' || p_query || '%'
    and (p_from is null or c.started_at >= p_from)
    and (p_to is null or c.started_at <= p_to)
  order by score desc
  limit p_limit;
$$;
