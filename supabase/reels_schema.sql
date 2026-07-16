-- Reelflix — standalone short-video Reels (TikTok-style posts, separate
-- from drama episodes: a Reel isn't part of a series, it's a one-off clip).
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql (profiles table) to already exist.

create table if not exists public.reels (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  video_path text not null,
  caption text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.reel_likes (
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (reel_id, user_id)
);

create table if not exists public.reel_comments (
  id uuid primary key default gen_random_uuid(),
  reel_id uuid not null references public.reels(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.reels enable row level security;
alter table public.reel_likes enable row level security;
alter table public.reel_comments enable row level security;

drop policy if exists "reels are viewable by everyone" on public.reels;
create policy "reels are viewable by everyone"
  on public.reels for select
  using (true);

drop policy if exists "creators manage their own reels" on public.reels;
create policy "creators manage their own reels"
  on public.reels for all
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

drop policy if exists "reel likes are viewable by everyone" on public.reel_likes;
create policy "reel likes are viewable by everyone"
  on public.reel_likes for select
  using (true);

drop policy if exists "users manage their own reel likes" on public.reel_likes;
create policy "users manage their own reel likes"
  on public.reel_likes for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "reel comments are viewable by everyone" on public.reel_comments;
create policy "reel comments are viewable by everyone"
  on public.reel_comments for select
  using (true);

drop policy if exists "users can post reel comments" on public.reel_comments;
create policy "users can post reel comments"
  on public.reel_comments for insert
  with check (auth.uid() = user_id);

alter publication supabase_realtime add table public.reel_comments;

-- Storage bucket for reel video files, same pattern as episode-videos.
insert into storage.buckets (id, name, public)
values ('reel-videos', 'reel-videos', true)
on conflict (id) do nothing;

drop policy if exists "reel videos are publicly readable" on storage.objects;
create policy "reel videos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'reel-videos');

-- Uploaded paths must be "{your-user-id}/{timestamp}.ext".
drop policy if exists "creators can upload their own reel videos" on storage.objects;
create policy "creators can upload their own reel videos"
  on storage.objects for insert
  with check (
    bucket_id = 'reel-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "creators can delete their own reel videos" on storage.objects;
create policy "creators can delete their own reel videos"
  on storage.objects for delete
  using (
    bucket_id = 'reel-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
