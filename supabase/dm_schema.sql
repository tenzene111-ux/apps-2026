-- Reelflix — real direct messages between users
-- Run this once in Supabase Dashboard → SQL Editor → New query → Run.

create table if not exists public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  receiver_id uuid not null references public.profiles(id) on delete cascade,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.dm_messages enable row level security;

drop policy if exists "users view their own conversations" on public.dm_messages;
create policy "users view their own conversations"
  on public.dm_messages for select
  using (auth.uid() = sender_id or auth.uid() = receiver_id);

drop policy if exists "users send messages as themselves" on public.dm_messages;
create policy "users send messages as themselves"
  on public.dm_messages for insert
  with check (auth.uid() = sender_id);

drop policy if exists "users mark received messages as read" on public.dm_messages;
create policy "users mark received messages as read"
  on public.dm_messages for update
  using (auth.uid() = receiver_id)
  with check (auth.uid() = receiver_id);

alter publication supabase_realtime add table public.dm_messages;
