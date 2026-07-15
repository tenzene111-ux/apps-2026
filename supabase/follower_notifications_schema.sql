-- Reelflix — notify all your followers when you go live or upload a new drama
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires live_schema.sql, content_schema.sql, and notifications_schema.sql
-- to already exist.

-- Fan out a "went_live" notification to every follower when a live session starts.
create or replace function public.notify_followers_on_live()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, actor_id, data)
  select follower_id, 'went_live', new.host_id, jsonb_build_object('room_name', new.room_name)
  from public.follows
  where followed_id = new.host_id;
  return new;
end;
$$;

drop trigger if exists on_live_session_started on public.live_sessions;
create trigger on_live_session_started
  after insert on public.live_sessions
  for each row execute procedure public.notify_followers_on_live();

-- Fan out a "new_drama" notification to every follower when a creator
-- uploads a drama's first episode (i.e. it actually becomes watchable) —
-- not on every subsequent episode, to avoid spamming followers during a
-- big upload session.
create or replace function public.notify_followers_on_new_drama()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_creator_id uuid;
  v_title text;
begin
  if new.episode_number <> 1 then
    return new;
  end if;

  select creator_id, title into v_creator_id, v_title from public.dramas where id = new.drama_id;
  if v_creator_id is null then
    return new;
  end if;

  insert into public.notifications (user_id, type, actor_id, data)
  select follower_id, 'new_drama', v_creator_id, jsonb_build_object('drama_id', new.drama_id, 'title', v_title)
  from public.follows
  where followed_id = v_creator_id;
  return new;
end;
$$;

drop trigger if exists on_first_episode_uploaded on public.episodes;
create trigger on_first_episode_uploaded
  after insert on public.episodes
  for each row execute procedure public.notify_followers_on_new_drama();
