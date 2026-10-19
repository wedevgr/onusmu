-- 0013_insights.sql
-- What the backend understood from each recording (tasks created or closed, money, readings),
-- shown back to the user with an undo. insights is encrypted JSON (see server/src/lib/insights.ts).
-- insights_seen_at is set when the user dismisses them on the home screen.

alter table public.transcript_chunks add column if not exists insights text;
alter table public.transcript_chunks add column if not exists insights_seen_at timestamptz;

create index if not exists transcript_chunks_unseen_insights_idx
  on public.transcript_chunks (user_id, started_at desc)
  where insights is not null and insights_seen_at is null;
