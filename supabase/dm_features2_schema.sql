-- Reelflix — more DM features: reactions, replies, voice notes, drama shares
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires dm_schema.sql, blocks_schema.sql, and dm_upgrades_schema.sql to
-- already exist.

alter table public.dm_messages add column if not exists reply_to_id uuid references public.dm_messages(id) on delete set null;
alter table public.dm_messages add column if not exists drama_share_id uuid references public.dramas(id) on delete set null;
alter table public.dm_messages add column if not exists audio_url text;

alter table public.dm_messages drop constraint if exists dm_messages_text_or_image;
alter table public.dm_messages add constraint dm_messages_text_or_image
  check (text is not null or image_url is not null or audio_url is not null or drama_share_id is not null);

-- Reactions (one emoji per user per message — reacting again replaces it).
create table if not exists public.dm_message_reactions (
  message_id uuid not null references public.dm_messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
alter table public.dm_message_reactions enable row level security;
alter table public.dm_message_reactions replica identity full;

drop policy if exists "users view reactions on their conversations" on public.dm_message_reactions;
create policy "users view reactions on their conversations"
  on public.dm_message_reactions for select
  using (
    exists (
      select 1 from public.dm_messages m
      where m.id = dm_message_reactions.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

drop policy if exists "users manage their own reactions" on public.dm_message_reactions;
create policy "users manage their own reactions"
  on public.dm_message_reactions for all
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.dm_messages m
      where m.id = dm_message_reactions.message_id
      and (m.sender_id = auth.uid() or m.receiver_id = auth.uid())
    )
  );

alter publication supabase_realtime add table public.dm_message_reactions;

-- Storage bucket for voice notes, same public-bucket pattern as dm-media.
insert into storage.buckets (id, name, public)
values ('dm-voice', 'dm-voice', true)
on conflict (id) do nothing;

drop policy if exists "dm voice notes are publicly readable" on storage.objects;
create policy "dm voice notes are publicly readable"
  on storage.objects for select
  using (bucket_id = 'dm-voice');

drop policy if exists "users can upload their own dm voice notes" on storage.objects;
create policy "users can upload their own dm voice notes"
  on storage.objects for insert
  with check (
    bucket_id = 'dm-voice'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
