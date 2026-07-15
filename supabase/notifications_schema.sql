-- Reelflix — real notifications (new follower, gift received)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql and live_schema.sql to already exist (profiles, send_gift).

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  actor_id uuid references public.profiles(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

drop policy if exists "users can view their own notifications" on public.notifications;
create policy "users can view their own notifications"
  on public.notifications for select
  using (auth.uid() = user_id);

drop policy if exists "users can update their own notifications" on public.notifications;
create policy "users can update their own notifications"
  on public.notifications for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.notifications;

-- 1. Notify a creator when someone follows them
create or replace function public.notify_new_follower()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, actor_id, data)
  values (new.followed_id, 'follow', new.follower_id, '{}'::jsonb);
  return new;
end;
$$;

drop trigger if exists on_follow_created on public.follows;
create trigger on_follow_created
  after insert on public.follows
  for each row execute procedure public.notify_new_follower();

-- 2. Notify a host when they receive a gift — redefines send_gift (same
-- signature as live_schema.sql) to also insert a notification row.
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
end;
$$;

grant execute on function public.send_gift(uuid, integer) to authenticated;
