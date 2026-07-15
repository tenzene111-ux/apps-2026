-- Reelflix — drama cover images, real feedback, real reports
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql and content_schema.sql to already exist.

-- 1. Cover images for dramas, stored in their own public bucket
alter table public.dramas add column if not exists cover_path text;

insert into storage.buckets (id, name, public)
values ('drama-covers', 'drama-covers', true)
on conflict (id) do nothing;

drop policy if exists "drama covers are publicly readable" on storage.objects;
create policy "drama covers are publicly readable"
  on storage.objects for select
  using (bucket_id = 'drama-covers');

drop policy if exists "creators can upload their own drama covers" on storage.objects;
create policy "creators can upload their own drama covers"
  on storage.objects for insert
  with check (
    bucket_id = 'drama-covers'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "creators can update their own drama covers" on storage.objects;
create policy "creators can update their own drama covers"
  on storage.objects for update
  using (bucket_id = 'drama-covers' and auth.uid()::text = (storage.foldername(name))[1]);

-- 2. Real feedback (write-only from the app; you review it yourself in the
-- Supabase Table Editor, which uses your own account and bypasses RLS)
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  text text not null,
  created_at timestamptz not null default now()
);
alter table public.feedback enable row level security;
drop policy if exists "users can submit feedback" on public.feedback;
create policy "users can submit feedback"
  on public.feedback for insert
  with check (auth.uid() = user_id);

-- 3. Real content reports (same write-only pattern, for moderation)
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  drama_id text,
  episode_number integer,
  reason text,
  created_at timestamptz not null default now()
);
alter table public.reports enable row level security;
drop policy if exists "users can submit reports" on public.reports;
create policy "users can submit reports"
  on public.reports for insert
  with check (auth.uid() = reporter_id);
