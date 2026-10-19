-- 0016_repeat.sql
-- Repeating tasks ("κάθε Δευτέρα να βγάζω τα σκουπίδια") and repeating payments ("κάθε 15 του
-- μήνα το ενοίκιο"). repeat is a JSON rule (see server/src/lib/recurrence.ts): freq, interval,
-- days, monthDay, month, time, start, until. A repeating row's due_at is always its next
-- occurrence: finishing a task or paying a bill moves it on instead of closing it.

alter table public.reminders add column if not exists repeat jsonb;
alter table public.reminders add column if not exists last_done_at timestamptz;

alter table public.memory_facts add column if not exists repeat jsonb;
