-- Reelflix — Phase 1 schema (auth + profiles + follows)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE everywhere.

-- 1. Profiles table: one row per signed-up user, linked to Supabase's built-in auth.users
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  avatar_url text,
  coins integer not null default 120,
  gems integer not null default 0,
  vip boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2. Follows table: who follows whom (powers the "mutual/friends first" For You ranking)
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followed_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followed_id)
);

-- 3. Auto-create a profile row whenever someone signs up
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- 4. Row Level Security: lock every table down, then open narrow policies
alter table public.profiles enable row level security;
alter table public.follows enable row level security;

drop policy if exists "profiles are viewable by everyone" on public.profiles;
create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "follows are viewable by everyone" on public.follows;
create policy "follows are viewable by everyone"
  on public.follows for select
  using (true);

drop policy if exists "users can manage their own follows" on public.follows;
create policy "users can manage their own follows"
  on public.follows for all
  using (auth.uid() = follower_id)
  with check (auth.uid() = follower_id);
