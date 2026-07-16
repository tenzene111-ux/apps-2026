-- Reelflix — let DMs share a standalone Reel (not just a drama)
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires dm_features2_schema.sql and reels_schema.sql to already exist.

alter table public.dm_messages add column if not exists reel_share_id uuid references public.reels(id) on delete set null;

alter table public.dm_messages drop constraint if exists dm_messages_text_or_image;
alter table public.dm_messages add constraint dm_messages_text_or_image
  check (
    text is not null
    or image_url is not null
    or audio_url is not null
    or drama_share_id is not null
    or reel_share_id is not null
  );
