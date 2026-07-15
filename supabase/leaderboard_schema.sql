-- Reelflix — real leaderboards (top creators, top gifters)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires live_schema.sql (send_gift) and notifications_schema.sql to already exist.

-- A real ledger of every gift ever sent, so leaderboards can be computed
-- from genuine transaction history instead of a guess.
create table if not exists public.gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  amount integer not null,
  created_at timestamptz not null default now()
);

alter table public.gifts enable row level security;

drop policy if exists "gifts are viewable by everyone" on public.gifts;
create policy "gifts are viewable by everyone"
  on public.gifts for select
  using (true);

-- Redefines send_gift (same signature as before) to also log the gift.
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

  insert into public.notifications (user_id, type, actor_id, data)
  values (p_host_id, 'gift', v_sender, jsonb_build_object('amount', p_amount));

  insert into public.gifts (sender_id, receiver_id, amount)
  values (v_sender, p_host_id, p_amount);
end;
$$;

grant execute on function public.send_gift(uuid, integer) to authenticated;
