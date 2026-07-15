-- Reelflix — notify creators when their drama gets a like or comment
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires content_schema.sql, engagement_schema.sql, and
-- notifications_schema.sql to already exist.

create or replace function public.notify_comment_on_drama()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_creator_id uuid;
begin
  select creator_id into v_creator_id from public.dramas where id::text = new.drama_id;
  if v_creator_id is not null and v_creator_id != new.user_id then
    insert into public.notifications (user_id, type, actor_id, data)
    values (v_creator_id, 'comment', new.user_id, jsonb_build_object('drama_id', new.drama_id, 'episode_number', new.episode_number));
  end if;
  return new;
end;
$$;

drop trigger if exists on_comment_created on public.comments;
create trigger on_comment_created
  after insert on public.comments
  for each row execute procedure public.notify_comment_on_drama();

create or replace function public.notify_like_on_drama()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_creator_id uuid;
begin
  select creator_id into v_creator_id from public.dramas where id = new.drama_id;
  if v_creator_id is not null and v_creator_id != new.user_id then
    insert into public.notifications (user_id, type, actor_id, data)
    values (v_creator_id, 'like', new.user_id, jsonb_build_object('drama_id', new.drama_id, 'episode_number', new.episode_number));
  end if;
  return new;
end;
$$;

drop trigger if exists on_like_created on public.episode_likes;
create trigger on_like_created
  after insert on public.episode_likes
  for each row execute procedure public.notify_like_on_drama();
