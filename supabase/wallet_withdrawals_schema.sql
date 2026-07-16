-- Reelflix — creator withdrawal requests
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires leaderboard_schema.sql (the "gifts" ledger) to already exist —
-- that's what a creator's real earned-coin balance is computed from.
--
-- This does NOT move any real money. It stores a real request; you (the
-- admin) review it and pay the creator manually outside the app, then flip
-- its status in the Table Editor (pending -> approved -> paid, or
-- -> rejected). Wire up an actual payout processor later and this table
-- becomes the audit trail / queue for that integration.

create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  coins_amount integer not null check (coins_amount > 0),
  currency_amount numeric(12,2) not null,
  payout_method text not null,
  payout_details text not null,
  status text not null default 'pending', -- pending | approved | paid | rejected
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.withdrawals enable row level security;

drop policy if exists "users view their own withdrawals" on public.withdrawals;
create policy "users view their own withdrawals"
  on public.withdrawals for select
  using (auth.uid() = user_id);

drop policy if exists "users request their own withdrawals" on public.withdrawals;
create policy "users request their own withdrawals"
  on public.withdrawals for insert
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.withdrawals;
