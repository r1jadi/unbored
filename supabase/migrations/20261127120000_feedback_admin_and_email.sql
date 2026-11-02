-- Feedback reaches the team: the admin console reads it, and email carries it.
--
-- `20261125120000_feedback.sql` stores what players send from Settings → Send
-- feedback. This migration adds the two ways it gets read:
--
--   1. `admin_feedback_directory` — the admin console's list. A `security
--      definer` function that checks the caller is staff (`admin_guard_staff`),
--      as every admin read does, and joins the sender's username.
--   2. A small outbox for email. `feedback.emailed_at` is null until the
--      notifications service has mailed a row to the team's inbox; the service
--      claims unsent rows with `feedback_pending_email` and stamps them with
--      `mark_feedback_emailed`. Both are granted to `service_role` only — the
--      sender's email address is read inside the function, never exposed to a
--      browser.
--
-- Safe in either order with the app deploy: without it the admin page shows an
-- error and no email goes out, and feedback is still stored.

alter table public.feedback
  add column if not exists emailed_at timestamptz;

create index if not exists feedback_unsent_idx
  on public.feedback (created_at)
  where emailed_at is null;

-- ─────────────────────────────────────────────────────────────────────────────
-- The admin console's list
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.admin_feedback_directory(
  p_category text default null,
  p_search   text default null,
  p_limit    integer default 50,
  p_offset   integer default 0
)
returns table (
  id              uuid,
  mood            smallint,
  category        text,
  message         text,
  context         text,
  sender_username text,
  emailed_at      timestamptz,
  created_at      timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit    integer := greatest(1, least(coalesce(p_limit, 50), 101));
  v_offset   integer := greatest(0, coalesce(p_offset, 0));
  v_search   text := nullif(btrim(coalesce(p_search, '')), '');
  v_category text := nullif(btrim(coalesce(p_category, '')), '');
begin
  perform public.admin_guard_staff();

  if v_category is not null and v_category not in ('idea', 'bug', 'praise', 'other') then
    raise exception 'unknown feedback category' using errcode = '22023';
  end if;

  return query
  select
    f.id,
    f.mood,
    f.category,
    f.message,
    f.context,
    coalesce(p.username::text, 'deleted account'),
    f.emailed_at,
    f.created_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  where (v_category is null or f.category = v_category)
    and (v_search is null or f.message ilike '%' || v_search || '%')
  order by f.created_at desc, f.id desc
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_feedback_directory(text, text, integer, integer) is
  'Every piece of feedback, newest first, with the sender''s username. Requires staff.';

revoke all on function public.admin_feedback_directory(text, text, integer, integer) from public, anon;
grant execute on function public.admin_feedback_directory(text, text, integer, integer) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The email outbox, for the notifications service
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.feedback_pending_email(p_limit integer default 10)
returns table (
  id              uuid,
  mood            smallint,
  category        text,
  message         text,
  context         text,
  sender_username text,
  sender_email    text,
  created_at      timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    f.id,
    f.mood,
    f.category,
    f.message,
    f.context,
    coalesce(p.username::text, 'deleted account'),
    u.email::text,
    f.created_at
  from public.feedback f
  left join public.profiles p on p.id = f.user_id
  left join auth.users u on u.id = f.user_id
  where f.emailed_at is null
  order by f.created_at asc, f.id asc
  limit greatest(1, least(coalesce(p_limit, 10), 25));
$$;

create or replace function public.mark_feedback_emailed(p_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.feedback set emailed_at = now() where id = p_id and emailed_at is null;
$$;

comment on function public.feedback_pending_email(integer) is
  'Feedback not yet emailed to the team, oldest first, with the sender''s username and email. Service role only.';
comment on function public.mark_feedback_emailed(uuid) is
  'Stamps one piece of feedback as emailed. Repeating the call changes nothing. Service role only.';

revoke all on function public.feedback_pending_email(integer) from public, anon, authenticated;
revoke all on function public.mark_feedback_emailed(uuid) from public, anon, authenticated;
grant execute on function public.feedback_pending_email(integer) to service_role;
grant execute on function public.mark_feedback_emailed(uuid) to service_role;
