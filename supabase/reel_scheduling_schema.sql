-- Reelflix — scheduled release for Reels (parity with drama episode scheduling)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires reels_schema.sql to already exist.

alter table public.reels add column if not exists release_at timestamptz;

-- A reel is visible to everyone once its own release_at (if set) has passed.
-- The creator can always see their own reels, scheduled or not, so they can
-- preview/manage them before the scheduled time.
drop policy if exists "reels are viewable by everyone" on public.reels;
create policy "reels are viewable by everyone"
  on public.reels for select
  using (
    (release_at is null or release_at <= now())
    or auth.uid() = creator_id
  );
