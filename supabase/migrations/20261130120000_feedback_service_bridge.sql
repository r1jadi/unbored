-- The feedback directory is an admin read just like the existing moderation
-- directories. Route allowlisted administrators through the service bridge so
-- they do not need a separate `user_roles` row to see it.

create or replace function public.admin_feedback_directory_svc(
  p_actor    uuid,
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
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_feedback_directory(p_category, p_search, p_limit, p_offset);
end;
$$;

comment on function public.admin_feedback_directory_svc(uuid, text, text, integer, integer) is
  'Privileged feedback directory for an allowlisted administrator. service_role only.';

revoke all on function public.admin_feedback_directory_svc(uuid, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.admin_feedback_directory_svc(uuid, text, text, integer, integer)
  to service_role;
