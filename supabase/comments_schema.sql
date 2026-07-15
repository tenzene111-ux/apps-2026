-- Reelflix — real comments on episodes
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.

create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  drama_id text not null,
  episode_number integer not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

drop policy if exists "comments are viewable by everyone" on public.comments;
create policy "comments are viewable by everyone"
  on public.comments for select
  using (true);

drop policy if exists "users can post their own comments" on public.comments;
create policy "users can post their own comments"
  on public.comments for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own comments" on public.comments;
create policy "users can delete their own comments"
  on public.comments for delete
  using (auth.uid() = user_id);

alter publication supabase_realtime add table public.comments;
