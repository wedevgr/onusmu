-- 0017_reminder_tags.sql
-- Tags the backend gives each reminder so the app can group and filter them (money, work,
-- home, car, ...), and for money reminders the amount and whether the user pays or collects.
-- meta is encrypted JSON (see server/src/lib/reminderTags.ts), like the reminder text.
-- Kept in its own table so reminders keep working on a server deployed before this migration.
-- A row is made when the reminder is first listed and dropped when its text is edited.

create table if not exists public.reminder_tags (
  reminder_id uuid primary key references public.reminders (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  meta        text not null,
  created_at  timestamptz not null default now()
);

create index if not exists reminder_tags_user_idx on public.reminder_tags (user_id);

alter table public.reminder_tags enable row level security;

drop policy if exists "reminder_tags owner access" on public.reminder_tags;
create policy "reminder_tags owner access" on public.reminder_tags
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
