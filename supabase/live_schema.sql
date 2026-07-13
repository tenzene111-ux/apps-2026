-- Reelflix — Phase 3 schema (real live streaming + real gift economy)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql (profiles table) to already exist.

-- 1. Live sessions: one row per live broadcast. A room is "live" while ended_at is null.
create table if not exists public.live_sessions (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  room_name text not null unique,
  title text not null default 'Live',
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

alter table public.live_sessions enable row level security;

drop policy if exists "live sessions are viewable by everyone" on public.live_sessions;
create policy "live sessions are viewable by everyone"
  on public.live_sessions for select
  using (true);

drop policy if exists "hosts can start their own live session" on public.live_sessions;
create policy "hosts can start their own live session"
  on public.live_sessions for insert
  with check (auth.uid() = host_id);

drop policy if exists "hosts can update their own live session" on public.live_sessions;
create policy "hosts can update their own live session"
  on public.live_sessions for update
  using (auth.uid() = host_id)
  with check (auth.uid() = host_id);

-- 2. Realtime: let clients subscribe to live_sessions changes (Live strip updates instantly)
alter publication supabase_realtime add table public.live_sessions;

-- 3. Atomic gift transfer: moves coins from the caller (sender) to a host's wallet.
-- Runs as the function owner (security definer) so it can credit someone else's
-- row despite RLS, but it only ever debits auth.uid() — never an arbitrary sender.
create or replace function public.send_gift(p_host_id uuid, p_amount integer)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
begin
  if v_sender is null then
    raise exception 'not_authenticated';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  if p_host_id = v_sender then
    raise exception 'cannot_gift_self';
  end if;

  update public.profiles set coins = coins - p_amount
    where id = v_sender and coins >= p_amount;
  if not found then
    raise exception 'insufficient_coins';
  end if;

  update public.profiles set coins = coins + p_amount where id = p_host_id;
  if not found then
    raise exception 'host_not_found';
  end if;
end;
$$;

grant execute on function public.send_gift(uuid, integer) to authenticated;
