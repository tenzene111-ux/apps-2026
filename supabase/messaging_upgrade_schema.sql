-- Reelflix — inbox upgrades: message requests, pin/mute, and group chats
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.
-- Requires schema.sql, dm_schema.sql, blocks_schema.sql, dm_upgrades_schema.sql,
-- and dm_features2_schema.sql to already exist.

-- ---------- Per-user 1:1 conversation settings (pin / mute / accept / hide) ----------
create table if not exists public.dm_conversation_meta (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  partner_id uuid not null references public.profiles(id) on delete cascade,
  pinned boolean not null default false,
  muted boolean not null default false,
  accepted boolean not null default false,
  hidden boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (owner_id, partner_id)
);
alter table public.dm_conversation_meta enable row level security;

drop policy if exists "users manage their own conversation meta" on public.dm_conversation_meta;
create policy "users manage their own conversation meta"
  on public.dm_conversation_meta for all
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

alter publication supabase_realtime add table public.dm_conversation_meta;

-- ---------- Group chats ----------
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_messages (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  text text,
  image_url text,
  audio_url text,
  created_at timestamptz not null default now(),
  constraint group_messages_text_or_image check (text is not null or image_url is not null or audio_url is not null)
);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_messages enable row level security;

drop policy if exists "members can view their groups" on public.groups;
create policy "members can view their groups"
  on public.groups for select
  using (exists (select 1 from public.group_members m where m.group_id = groups.id and m.user_id = auth.uid()));

drop policy if exists "authenticated users can create groups" on public.groups;
create policy "authenticated users can create groups"
  on public.groups for insert
  with check (auth.uid() = created_by);

drop policy if exists "members can view group members" on public.group_members;
create policy "members can view group members"
  on public.group_members for select
  using (exists (select 1 from public.group_members m2 where m2.group_id = group_members.group_id and m2.user_id = auth.uid()));

drop policy if exists "creator or existing member can add group members" on public.group_members;
create policy "creator or existing member can add group members"
  on public.group_members for insert
  with check (
    exists (select 1 from public.groups g where g.id = group_members.group_id and g.created_by = auth.uid())
    or exists (select 1 from public.group_members m where m.group_id = group_members.group_id and m.user_id = auth.uid())
  );

drop policy if exists "members can leave groups" on public.group_members;
create policy "members can leave groups"
  on public.group_members for delete
  using (auth.uid() = user_id);

drop policy if exists "members can view group messages" on public.group_messages;
create policy "members can view group messages"
  on public.group_messages for select
  using (exists (select 1 from public.group_members m where m.group_id = group_messages.group_id and m.user_id = auth.uid()));

drop policy if exists "members can send group messages" on public.group_messages;
create policy "members can send group messages"
  on public.group_messages for insert
  with check (
    auth.uid() = sender_id
    and exists (select 1 from public.group_members m where m.group_id = group_messages.group_id and m.user_id = auth.uid())
  );

alter publication supabase_realtime add table public.group_messages;
alter publication supabase_realtime add table public.group_members;

-- ---------- Voice / video call signaling ----------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  caller_id uuid not null references public.profiles(id) on delete cascade,
  callee_id uuid not null references public.profiles(id) on delete cascade,
  room text not null,
  is_video boolean not null default false,
  status text not null default 'ringing', -- ringing | accepted | declined | ended | missed
  created_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.calls enable row level security;

drop policy if exists "participants can view their calls" on public.calls;
create policy "participants can view their calls"
  on public.calls for select
  using (auth.uid() = caller_id or auth.uid() = callee_id);

drop policy if exists "caller can start a call" on public.calls;
create policy "caller can start a call"
  on public.calls for insert
  with check (auth.uid() = caller_id);

drop policy if exists "participants can update call status" on public.calls;
create policy "participants can update call status"
  on public.calls for update
  using (auth.uid() = caller_id or auth.uid() = callee_id);

alter publication supabase_realtime add table public.calls;

-- Storage bucket for group images, same pattern as dm-media.
insert into storage.buckets (id, name, public)
values ('group-media', 'group-media', true)
on conflict (id) do nothing;

drop policy if exists "group media are publicly readable" on storage.objects;
create policy "group media are publicly readable"
  on storage.objects for select
  using (bucket_id = 'group-media');

drop policy if exists "users can upload their own group media" on storage.objects;
create policy "users can upload their own group media"
  on storage.objects for insert
  with check (
    bucket_id = 'group-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );
