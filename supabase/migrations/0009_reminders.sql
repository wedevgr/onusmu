-- 0009_reminders.sql
-- Reminders: created by the user, or suggested by the backend when a recording contains
-- something the user said they need to do. Suggestions wait for the user to confirm them.
-- text is encrypted by the backend (see server/src/lib/crypto.ts), like transcripts.
-- user_settings.timezone lets the backend turn "tomorrow at 5" into an exact time.
-- user_settings.auto_reminders skips the confirmation: reminders from recordings are created directly.

create table if not exists public.reminders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  text            text not null,
  due_at          timestamptz,              -- null = no time given
  status          text not null default 'pending'
                  check (status in ('suggested', 'pending', 'done', 'dismissed')),
  source_chunk_id uuid references public.transcript_chunks (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists reminders_user_status_due_idx
  on public.reminders (user_id, status, due_at);

alter table public.reminders enable row level security;

drop policy if exists "reminders owner access" on public.reminders;
create policy "reminders owner access" on public.reminders
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

alter table public.user_settings add column if not exists timezone text;
alter table public.user_settings add column if not exists auto_reminders boolean not null default false;
