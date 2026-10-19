-- 0012_facts.sql
-- Facts taken from recordings: money spent, received, owed by the user or owed to them, and
-- measurements such as a car's mileage. Chat sums and compares these exactly instead of
-- estimating from transcript text.
-- data is encrypted JSON (see server/src/lib/crypto.ts), like transcripts; totals are computed
-- in the backend after decrypting. A fact disappears with the recording it came from.

create table if not exists public.memory_facts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  chunk_id     uuid not null references public.transcript_chunks (id) on delete cascade,
  kind         text not null,          -- expense | income | debt (user owes) | receivable (owed to user) | measure
  data         text not null,          -- encrypted JSON: text, amount, currency, who, paidBy, item, value, unit
  occurred_at  timestamptz not null,   -- when it happened (the recording time unless said otherwise)
  due_at       timestamptz,            -- debts and receivables: pay by
  created_at   timestamptz not null default now()
);

alter table public.memory_facts drop constraint if exists memory_facts_kind_check;
alter table public.memory_facts add constraint memory_facts_kind_check
  check (kind in ('expense', 'income', 'debt', 'receivable', 'measure'));

create index if not exists memory_facts_user_time_idx on public.memory_facts (user_id, occurred_at desc);
create index if not exists memory_facts_chunk_idx on public.memory_facts (chunk_id);

alter table public.memory_facts enable row level security;

drop policy if exists "memory_facts owner access" on public.memory_facts;
create policy "memory_facts owner access" on public.memory_facts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
