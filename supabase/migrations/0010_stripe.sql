-- 0010_stripe.sql
-- New plan line-up and Stripe customers for website subscriptions.
-- Plans (allowances live in server/src/lib/billing.ts, prices in Stripe):
--   starter 30 min/day, plus 5 h/day, pro 10 h/day, unlimited. No row = free (5 min/day).
-- billing_customers links a user to their Stripe customer, created at first checkout.

alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
alter table public.subscriptions add constraint subscriptions_plan_check
  check (plan in ('starter', 'plus', 'pro', 'unlimited'));

create table if not exists public.billing_customers (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id text not null unique,
  created_at         timestamptz not null default now()
);

alter table public.billing_customers enable row level security;

-- Written only by the backend.
drop policy if exists "billing_customers owner read" on public.billing_customers;
create policy "billing_customers owner read" on public.billing_customers
  for select to authenticated
  using (user_id = auth.uid());
