-- Reelflix — TikTok-style Reel editing (trim/filter/adjust/text/stickers are
-- applied at playback time from stored metadata, not baked into the video
-- file — same visible result, no re-encoding pipeline needed) plus real
-- creator settings (audience, comments/duet/stitch/download, tags, location,
-- content disclosure).
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires reels_schema.sql to already exist.

alter table public.reels add column if not exists cover_path text;
alter table public.reels add column if not exists location text;
alter table public.reels add column if not exists visibility text not null default 'public' check (visibility in ('public', 'private'));
alter table public.reels add column if not exists allow_comments boolean not null default true;
alter table public.reels add column if not exists allow_duet boolean not null default true;
alter table public.reels add column if not exists allow_stitch boolean not null default true;
alter table public.reels add column if not exists allow_download boolean not null default true;
alter table public.reels add column if not exists content_disclosure text not null default 'none' check (content_disclosure in ('none', 'ai_generated', 'paid_promotion', 'both'));
alter table public.reels add column if not exists trim_start numeric not null default 0;
alter table public.reels add column if not exists trim_end numeric;
alter table public.reels add column if not exists filter_css text;
alter table public.reels add column if not exists overlays jsonb not null default '[]'::jsonb;

create table if not exists public.reel_tags (
  reel_id uuid not null references public.reels(id) on delete cascade,
  tagged_user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (reel_id, tagged_user_id)
);
alter table public.reel_tags enable row level security;

drop policy if exists "reel tags are viewable by everyone" on public.reel_tags;
create policy "reel tags are viewable by everyone"
  on public.reel_tags for select
  using (true);

drop policy if exists "creators manage their own reel tags" on public.reel_tags;
create policy "creators manage their own reel tags"
  on public.reel_tags for all
  using (exists (select 1 from public.reels where reels.id = reel_tags.reel_id and reels.creator_id = auth.uid()))
  with check (exists (select 1 from public.reels where reels.id = reel_tags.reel_id and reels.creator_id = auth.uid()));

-- Respect visibility ('private' = only the creator can see it) alongside the
-- existing scheduled-release window from reel_scheduling_schema.sql.
drop policy if exists "reels are viewable by everyone" on public.reels;
create policy "reels are viewable by everyone"
  on public.reels for select
  using (
    (visibility = 'public' and (release_at is null or release_at <= now()))
    or auth.uid() = creator_id
  );

-- Drama-side parity: a real "premium" flag (drama is fully locked regardless
-- of free_episodes) and a language label; per-episode download permission.
alter table public.dramas add column if not exists is_premium boolean not null default false;
alter table public.dramas add column if not exists language text not null default 'english';
alter table public.episodes add column if not exists allow_download boolean not null default true;
alter table public.episodes add column if not exists title text;
alter table public.episodes add column if not exists description text;
