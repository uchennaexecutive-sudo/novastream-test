-- Watch Party Phase C Supabase setup
-- Run this in the Supabase SQL editor for the NOVA STREAM project before
-- testing the real create/join flows added in Phase C.

create extension if not exists pgcrypto;

create table if not exists public.watch_party_rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  host_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'lobby',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  ended_at timestamptz null,
  constraint watch_party_rooms_code_format
    check (code ~ '^[A-Z0-9]{6}$'),
  constraint watch_party_rooms_status_check
    check (status in ('lobby', 'live', 'ended'))
);

create table if not exists public.watch_party_participants (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.watch_party_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_host boolean not null default false,
  is_muted boolean not null default false,
  joined_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint watch_party_participants_unique_room_user
    unique (room_id, user_id)
);

create index if not exists idx_watch_party_rooms_code
  on public.watch_party_rooms (code);

create index if not exists idx_watch_party_rooms_host_status
  on public.watch_party_rooms (host_user_id, status);

create index if not exists idx_watch_party_participants_room
  on public.watch_party_participants (room_id);

create index if not exists idx_watch_party_participants_user
  on public.watch_party_participants (user_id);

alter table public.watch_party_rooms enable row level security;
alter table public.watch_party_participants enable row level security;

drop policy if exists "watch party rooms authenticated select active" on public.watch_party_rooms;
create policy "watch party rooms authenticated select active"
on public.watch_party_rooms
for select
to authenticated
using (
  status in ('lobby', 'live')
  or host_user_id = auth.uid()
  or exists (
    select 1
    from public.watch_party_participants participant
    where participant.room_id = watch_party_rooms.id
      and participant.user_id = auth.uid()
  )
);

drop policy if exists "watch party rooms host insert" on public.watch_party_rooms;
create policy "watch party rooms host insert"
on public.watch_party_rooms
for insert
to authenticated
with check (
  host_user_id = auth.uid()
  and code ~ '^[A-Z0-9]{6}$'
  and status in ('lobby', 'live', 'ended')
);

drop policy if exists "watch party rooms host update" on public.watch_party_rooms;
create policy "watch party rooms host update"
on public.watch_party_rooms
for update
to authenticated
using (host_user_id = auth.uid())
with check (host_user_id = auth.uid());

drop policy if exists "watch party participants select same room" on public.watch_party_participants;
create policy "watch party participants select same room"
on public.watch_party_participants
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.watch_party_participants self_participant
    where self_participant.room_id = watch_party_participants.room_id
      and self_participant.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.watch_party_rooms room
    where room.id = watch_party_participants.room_id
      and room.host_user_id = auth.uid()
  )
);

drop policy if exists "watch party participants self insert" on public.watch_party_participants;
create policy "watch party participants self insert"
on public.watch_party_participants
for insert
to authenticated
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.watch_party_rooms room
    where room.id = room_id
      and room.status in ('lobby', 'live')
  )
);

drop policy if exists "watch party participants self or host update" on public.watch_party_participants;
create policy "watch party participants self or host update"
on public.watch_party_participants
for update
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.watch_party_rooms room
    where room.id = watch_party_participants.room_id
      and room.host_user_id = auth.uid()
  )
)
with check (
  user_id = auth.uid()
  or exists (
    select 1
    from public.watch_party_rooms room
    where room.id = watch_party_participants.room_id
      and room.host_user_id = auth.uid()
  )
);

drop policy if exists "watch party participants self or host delete" on public.watch_party_participants;
create policy "watch party participants self or host delete"
on public.watch_party_participants
for delete
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.watch_party_rooms room
    where room.id = watch_party_participants.room_id
      and room.host_user_id = auth.uid()
  )
);
