-- Reelflix — real view counts and real per-episode likes
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires content_schema.sql (dramas table) to already exist.
-- Applies only to real user-uploaded dramas, not the original demo content.

create table if not exists public.drama_views (
  drama_id uuid not null references public.dramas(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (drama_id, user_id)
);
alter table public.drama_views enable row level security;

drop policy if exists "views are viewable by everyone" on public.drama_views;
create policy "views are viewable by everyone"
  on public.drama_views for select
  using (true);

drop policy if exists "users record their own views" on public.drama_views;
create policy "users record their own views"
  on public.drama_views for insert
  with check (auth.uid() = user_id);

create table if not exists public.episode_likes (
  drama_id uuid not null references public.dramas(id) on delete cascade,
  episode_number integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (drama_id, episode_number, user_id)
);
alter table public.episode_likes enable row level security;

drop policy if exists "likes are viewable by everyone" on public.episode_likes;
create policy "likes are viewable by everyone"
  on public.episode_likes for select
  using (true);

drop policy if exists "users manage their own likes" on public.episode_likes;
create policy "users manage their own likes"
  on public.episode_likes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
