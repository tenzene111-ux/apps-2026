-- Reelflix — cross-device watch history
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.

create table if not exists public.watch_history (
  user_id uuid not null references public.profiles(id) on delete cascade,
  drama_id text not null,
  episode_number integer not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, drama_id)
);

alter table public.watch_history enable row level security;

drop policy if exists "users manage their own watch history" on public.watch_history;
create policy "users manage their own watch history"
  on public.watch_history for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
