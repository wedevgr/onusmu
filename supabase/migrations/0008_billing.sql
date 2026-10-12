-- 0008_billing.sql
-- Plans and recording quotas.
-- subscriptions: one row per paying user, written only by the backend (payment webhooks).
--   No row, or a row past expires_at, means the free plan.
-- recording_usage: seconds of audio accepted per user per day. Kept separately from
--   transcript_chunks so deleting a recording does not hand the quota back.

create table if not exists public.subscriptions (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  plan         text not null check (plan in ('plus', 'unlimited')),
  provider     text not null,              -- 'app_store' | 'play_store' | 'stripe' | 'manual'
  provider_ref text,                       -- subscription / transaction id at the provider
  expires_at   timestamptz,                -- end of the paid period; null = no expiry
  updated_at   timestamptz not null default now()
);

create table if not exists public.recording_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,                   -- calendar day in the backend's BILLING_TIMEZONE
  seconds int not null default 0,
  primary key (user_id, day)
);

alter table public.subscriptions enable row level security;
alter table public.recording_usage enable row level security;

-- Read-only for the owner: clients must never be able to grant themselves a plan or reset usage.
drop policy if exists "subscriptions owner read" on public.subscriptions;
create policy "subscriptions owner read" on public.subscriptions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists "recording_usage owner read" on public.recording_usage;
create policy "recording_usage owner read" on public.recording_usage
  for select to authenticated
  using (user_id = auth.uid());
