-- Reelflix — reusable Reel "sounds" (upload your own audio to record a
-- Reel over, TikTok-style — real feature: sounds are either a directly
-- uploaded audio file, or reused from an existing Reel's own audio track).
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires reels_schema.sql to already exist.

create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  uploader_id uuid not null references public.profiles(id) on delete cascade,
  audio_path text not null,
  duration numeric,
  created_at timestamptz not null default now()
);

alter table public.sounds enable row level security;

drop policy if exists "sounds are viewable by everyone" on public.sounds;
create policy "sounds are viewable by everyone"
  on public.sounds for select
  using (true);

drop policy if exists "creators manage their own sounds" on public.sounds;
create policy "creators manage their own sounds"
  on public.sounds for all
  using (auth.uid() = uploader_id)
  with check (auth.uid() = uploader_id);

insert into storage.buckets (id, name, public)
values ('sound-audio', 'sound-audio', true)
on conflict (id) do nothing;

drop policy if exists "sound audio is publicly readable" on storage.objects;
create policy "sound audio is publicly readable"
  on storage.objects for select
  using (bucket_id = 'sound-audio');

-- Uploaded paths must be "{your-user-id}/{timestamp}.ext".
drop policy if exists "creators can upload their own sound audio" on storage.objects;
create policy "creators can upload their own sound audio"
  on storage.objects for insert
  with check (
    bucket_id = 'sound-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "creators can delete their own sound audio" on storage.objects;
create policy "creators can delete their own sound audio"
  on storage.objects for delete
  using (
    bucket_id = 'sound-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

alter table public.reels add column if not exists sound_id uuid references public.sounds(id) on delete set null;
