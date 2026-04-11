alter table public.watch_party_participants
  add column if not exists display_name text,
  add column if not exists avatar_style text,
  add column if not exists avatar_seed text;

update public.watch_party_participants participant
set
  display_name = coalesce(nullif(profile.username, ''), participant.display_name),
  avatar_style = coalesce(nullif(profile.avatar_style, ''), participant.avatar_style, 'bottts'),
  avatar_seed = coalesce(nullif(profile.avatar_seed, ''), participant.avatar_seed, participant.user_id::text)
from public.profiles profile
where profile.id = participant.user_id
  and (
    participant.display_name is null
    or participant.avatar_style is null
    or participant.avatar_seed is null
  );
