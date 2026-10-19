-- 0011_terms.sql
-- The user's own vocabulary: people, places, businesses and things they mention, with the
-- misheard spellings seen for each. Built from recordings by the backend and editable in the app.
-- It guides transcription (correct spelling of names), search (variants match too) and chat
-- (who or what a name refers to). term, note and variants are encrypted by the backend
-- (see server/src/lib/crypto.ts), like transcripts; matching happens in the backend.

create table if not exists public.user_terms (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  term          text not null,                       -- canonical spelling, encrypted
  kind          text not null default 'other'
                check (kind in ('person', 'place', 'business', 'thing', 'other')),
  note          text not null default '',            -- what it is, e.g. "συνεργείο αυτοκινήτου", encrypted
  variants      text not null default '',            -- JSON array of other spellings, encrypted
  mentions      int not null default 1,
  source        text not null default 'auto' check (source in ('auto', 'user')),
  hidden        boolean not null default false,      -- removed by the user; kept so it is not re-added
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists user_terms_user_idx on public.user_terms (user_id, mentions desc);

alter table public.user_terms enable row level security;

drop policy if exists "user_terms owner access" on public.user_terms;
create policy "user_terms owner access" on public.user_terms
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
