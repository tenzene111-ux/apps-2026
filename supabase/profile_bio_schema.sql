-- Reelflix — add an editable bio to profiles (for the Profile page redesign)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql to already exist.

alter table public.profiles add column if not exists bio text;
