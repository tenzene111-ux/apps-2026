-- Reelflix — real user blocking
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql and dm_schema.sql to already exist.

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

drop policy if exists "users view their own blocks" on public.blocks;
create policy "users view their own blocks"
  on public.blocks for select
  using (auth.uid() = blocker_id);

drop policy if exists "users manage their own blocks" on public.blocks;
create policy "users manage their own blocks"
  on public.blocks for all
  using (auth.uid() = blocker_id)
  with check (auth.uid() = blocker_id);

-- Let reports also target a user directly (not just a drama/episode).
alter table public.reports add column if not exists reported_user_id uuid references public.profiles(id) on delete set null;

-- A blocked user can no longer DM you. Replaces the dm_messages insert
-- policy from dm_schema.sql with the same rule plus a block check.
drop policy if exists "users send messages as themselves" on public.dm_messages;
create policy "users send messages as themselves"
  on public.dm_messages for insert
  with check (
    auth.uid() = sender_id
    and not exists (
      select 1 from public.blocks b
      where b.blocker_id = dm_messages.receiver_id and b.blocked_id = dm_messages.sender_id
    )
  );
