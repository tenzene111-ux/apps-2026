-- Reelflix — real view tracking for Reels and per-episode Drama views
-- (drama_views only tracks the whole series, not which episode — this adds
-- the per-episode granularity needed for real Episode Analytics), plus a
-- real "Branded Content" disclosure flag for reels.
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires reels_schema.sql and content_schema.sql to already exist.

create table if not exists public.reel_views (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);
alter table public.reel_views enable row level security;

drop policy if exists "reel views are viewable by everyone" on public.reel_views;
create policy "reel views are viewable by everyone"
  on public.reel_views for select
  using (true);

drop policy if exists "users record their own reel views" on public.reel_views;
create policy "users record their own reel views"
  on public.reel_views for insert
  with check (auth.uid() = user_id);

create table if not exists public.episode_views (
  drama_id uuid not null references public.dramas(id) on delete cascade,
  episode_number integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (drama_id, episode_number, user_id)
);
alter table public.episode_views enable row level security;

drop policy if exists "episode views are viewable by everyone" on public.episode_views;
create policy "episode views are viewable by everyone"
  on public.episode_views for select
  using (true);

drop policy if exists "users record their own episode views" on public.episode_views;
create policy "users record their own episode views"
  on public.episode_views for insert
  with check (auth.uid() = user_id);

alter table public.reels add column if not exists branded_content boolean not null default false;
