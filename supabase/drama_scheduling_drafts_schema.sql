-- Reelflix — drama drafts + scheduled episode releases
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires content_schema.sql to already exist.

alter table public.dramas add column if not exists is_draft boolean not null default false;
alter table public.episodes add column if not exists release_at timestamptz;

-- A draft drama is only visible to its creator. Once published (is_draft = false)
-- it's visible to everyone, same as before.
drop policy if exists "dramas are viewable by everyone" on public.dramas;
create policy "dramas are viewable by everyone"
  on public.dramas for select
  using (not is_draft or auth.uid() = creator_id);

-- An episode is visible to everyone once its parent drama is published AND its
-- own release_at (if set) has passed. The creator can always see their own
-- episodes, draft or scheduled, so they can manage/preview them.
drop policy if exists "episodes are viewable by everyone" on public.episodes;
create policy "episodes are viewable by everyone"
  on public.episodes for select
  using (
    (
      (release_at is null or release_at <= now())
      and exists (select 1 from public.dramas d where d.id = episodes.drama_id and not d.is_draft)
    )
    or exists (select 1 from public.dramas d where d.id = episodes.drama_id and d.creator_id = auth.uid())
  );
