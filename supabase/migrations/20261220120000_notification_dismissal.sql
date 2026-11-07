-- Lets a player delete a notification from their own list.
--
-- A dismissal, not a DELETE. The rows are also a record: `notify_follow` and
-- `notify_score_beaten` read them to send one piece of news a day or every six hours,
-- and `admin_broadcast_directory` counts reads from them. A real delete would let
-- follow, unfollow, delete, repeat buzz someone's phone without limit, and would shrink
-- a broadcast's read count.
--
-- The existing owner-scoped update policy covers the row, so only the column grant is
-- new. Apply before the build that reads `dismissed_at`.

alter table public.notifications
  add column if not exists dismissed_at timestamptz;

comment on column public.notifications.dismissed_at is
  'When the player deleted this from their list. The row stays for rate limits and broadcast counts.';

grant update (dismissed_at) on public.notifications to authenticated;
