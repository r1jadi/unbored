-- Players choose whether they get announcements from the Unbored team.
--
-- On its own, ahead of the broadcast migration: the preference has to exist before the
-- function that reads it, and before the client that saves it.

alter table public.user_preferences
  add column if not exists notify_announcements boolean not null default true;
