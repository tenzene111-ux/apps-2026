-- Reelflix — Phase 2 schema (real user-uploaded drama content)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql (profiles table) to already exist.

-- 1. Dramas: one row per user-created series
create table if not exists public.dramas (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text not null default '',
  genre text not null default 'romance',
  free_episodes integer not null default 3,
  created_at timestamptz not null default now()
);

-- 2. Episodes: one row per uploaded video, belonging to a drama
create table if not exists public.episodes (
  id uuid primary key default gen_random_uuid(),
  drama_id uuid not null references public.dramas(id) on delete cascade,
  episode_number integer not null,
  video_path text not null,
  created_at timestamptz not null default now(),
  unique (drama_id, episode_number)
);

alter table public.dramas enable row level security;
alter table public.episodes enable row level security;

drop policy if exists "dramas are viewable by everyone" on public.dramas;
create policy "dramas are viewable by everyone"
  on public.dramas for select
  using (true);

drop policy if exists "creators manage their own dramas" on public.dramas;
create policy "creators manage their own dramas"
  on public.dramas for all
  using (auth.uid() = creator_id)
  with check (auth.uid() = creator_id);

drop policy if exists "episodes are viewable by everyone" on public.episodes;
create policy "episodes are viewable by everyone"
  on public.episodes for select
  using (true);

drop policy if exists "creators manage their own episodes" on public.episodes;
create policy "creators manage their own episodes"
  on public.episodes for all
  using (exists (select 1 from public.dramas d where d.id = episodes.drama_id and d.creator_id = auth.uid()))
  with check (exists (select 1 from public.dramas d where d.id = episodes.drama_id and d.creator_id = auth.uid()));

-- 3. Storage bucket for episode video files (created here, no dashboard clicking needed)
insert into storage.buckets (id, name, public)
values ('episode-videos', 'episode-videos', true)
on conflict (id) do nothing;

drop policy if exists "episode videos are publicly readable" on storage.objects;
create policy "episode videos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'episode-videos');

-- Uploaded paths must be "{your-user-id}/{dramaId}/{episodeNumber}.ext" —
-- this policy checks the first path segment matches your own auth.uid().
drop policy if exists "creators can upload their own episode videos" on storage.objects;
create policy "creators can upload their own episode videos"
  on storage.objects for insert
  with check (
    bucket_id = 'episode-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "creators can delete their own episode videos" on storage.objects;
create policy "creators can delete their own episode videos"
  on storage.objects for delete
  using (
    bucket_id = 'episode-videos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
