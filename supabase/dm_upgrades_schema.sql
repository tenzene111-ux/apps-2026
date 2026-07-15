-- Reelflix — DM upgrades: image messages, delete/unsend, online/last-seen
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires dm_schema.sql and blocks_schema.sql to already exist.

-- Image messages: a message can now carry an image instead of (or alongside) text.
alter table public.dm_messages add column if not exists image_url text;
alter table public.dm_messages alter column text drop not null;
alter table public.dm_messages add constraint dm_messages_text_or_image
  check (text is not null or image_url is not null);

-- Needed so Realtime DELETE events include the deleted row's columns
-- (used to filter "was this delete relevant to me" and remove the bubble
-- from the other person's screen).
alter table public.dm_messages replica identity full;

-- Sender can unsend their own message within a 10-minute window.
drop policy if exists "sender can delete own recent messages" on public.dm_messages;
create policy "sender can delete own recent messages"
  on public.dm_messages for delete
  using (auth.uid() = sender_id and created_at > now() - interval '10 minutes');

-- Storage bucket for DM images, same public-bucket pattern as drama-covers.
insert into storage.buckets (id, name, public)
values ('dm-media', 'dm-media', true)
on conflict (id) do nothing;

drop policy if exists "dm media are publicly readable" on storage.objects;
create policy "dm media are publicly readable"
  on storage.objects for select
  using (bucket_id = 'dm-media');

-- Uploaded paths must be "{your-user-id}/{filename}" — this policy checks
-- the first path segment matches your own auth.uid().
drop policy if exists "users can upload their own dm images" on storage.objects;
create policy "users can upload their own dm images"
  on storage.objects for insert
  with check (
    bucket_id = 'dm-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Online / last-seen: a simple timestamp on the profile, updated by the
-- client on sign-in and periodically while the app is open. Covered by
-- the existing "users can update own profile" policy from schema.sql.
alter table public.profiles add column if not exists last_seen timestamptz;
