-- Reelflix — move reward/quest claims and gem redemptions to your account
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Prevents claiming daily/quest/first-login rewards repeatedly by
-- clearing browser storage or reinstalling — claims are now tied to
-- your real account instead of localStorage.

create table if not exists public.reward_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  claim_key text not null,
  claimed_at timestamptz not null default now(),
  primary key (user_id, claim_key)
);

alter table public.reward_claims enable row level security;

drop policy if exists "users manage their own reward claims" on public.reward_claims;
create policy "users manage their own reward claims"
  on public.reward_claims for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.redemptions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  item_id text not null,
  count integer not null default 0,
  primary key (user_id, item_id)
);

alter table public.redemptions enable row level security;

drop policy if exists "users manage their own redemptions" on public.redemptions;
create policy "users manage their own redemptions"
  on public.redemptions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
