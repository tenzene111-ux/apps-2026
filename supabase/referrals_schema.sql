-- Reelflix — real referral / invite-code system
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql and notifications_schema.sql to already exist.

-- Every profile gets a real, stable, shareable code derived from its own id
-- (first 8 hex chars of the uuid, uppercased) — no extra signup step needed,
-- and it's guaranteed present for existing users the moment this column is added.
alter table public.profiles
  add column if not exists referral_code text
  generated always as (upper(substr(replace(id::text, '-', ''), 1, 8))) stored;

create unique index if not exists profiles_referral_code_idx on public.profiles(referral_code);

-- One row per successful redemption — a user can only ever be referred once.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(id) on delete cascade,
  referred_id uuid not null references public.profiles(id) on delete cascade unique,
  created_at timestamptz not null default now()
);

alter table public.referrals enable row level security;

drop policy if exists "users view their own referrals" on public.referrals;
create policy "users view their own referrals"
  on public.referrals for select
  using (auth.uid() = referrer_id or auth.uid() = referred_id);

-- Redeeming a code is a single atomic server-side transaction (like send_gift)
-- so a client can't self-refer, double-redeem, or grant itself coins directly.
create or replace function public.redeem_referral_code(p_code text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_referrer uuid;
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  if p_code is null or length(trim(p_code)) = 0 then
    raise exception 'invalid_code';
  end if;
  if exists (select 1 from public.referrals where referred_id = v_user) then
    raise exception 'already_redeemed';
  end if;

  select id into v_referrer from public.profiles where referral_code = upper(trim(p_code));
  if v_referrer is null then
    raise exception 'invalid_code';
  end if;
  if v_referrer = v_user then
    raise exception 'cannot_refer_self';
  end if;

  insert into public.referrals (referrer_id, referred_id) values (v_referrer, v_user);
  update public.profiles set coins = coins + 50 where id = v_user;
  update public.profiles set coins = coins + 100 where id = v_referrer;

  insert into public.notifications (user_id, type, actor_id, data)
  values (v_referrer, 'referral', v_user, jsonb_build_object('bonus', 100));
end;
$$;

grant execute on function public.redeem_referral_code(text) to authenticated;
