-- 0014_briefing.sql
-- Morning briefing: a daily notification with the day's appointments, payments due, open tasks
-- and nudges (money owed for a while, a service coming up). The app schedules it locally from
-- GET /v1/briefing; these settings say whether and when.

alter table public.user_settings add column if not exists briefing_enabled boolean not null default true;
alter table public.user_settings add column if not exists briefing_time text not null default '08:30'
  check (briefing_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
