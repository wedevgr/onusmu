-- 0015_vector_iterative_scan.sql
-- The HNSW index finds the nearest chunks across all users first and applies the user and time
-- filters afterwards. With many users that leaves few or none of the asking user's chunks.
-- pgvector 0.8 iterative scan keeps walking the index until enough rows pass the filters;
-- strict_order keeps the results ordered by distance. Same signature and output as 0007.

-- The hnsw.* settings only exist once the vector extension's library is loaded in this
-- connection. Before that they are unknown placeholders, and Supabase's postgres role (not a
-- superuser) may not put those on a function: "permission denied to set parameter". Using a
-- vector value loads the library, so the SET clauses below are accepted in any session.
select '[1]'::vector;

create or replace function public.match_chunks(
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
set hnsw.iterative_scan = 'strict_order'
set hnsw.ef_search = '100'
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
