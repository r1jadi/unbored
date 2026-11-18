-- One-click email unsubscribe (CAN-SPAM, RFC 8058).
--
-- Marketing emails (the new-games digest and the weekly recap) carry a signed
-- link and List-Unsubscribe headers. The notifications service verifies the
-- signature and calls this function with the service key, so opting out needs
-- no sign-in. It only ever turns a preference off.
--
-- Rollback:
--   drop function if exists public.email_unsubscribe(uuid, text);

create or replace function public.email_unsubscribe(p_user_id uuid, p_kind text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed integer;
begin
  if p_kind = 'new-games' then
    update public.user_preferences set notify_new_games = false
     where user_id = p_user_id and notify_new_games;
  elsif p_kind = 'weekly-recap' then
    update public.user_preferences set notify_weekly_recap = false
     where user_id = p_user_id and notify_weekly_recap;
  else
    raise exception 'unknown email kind %', p_kind using errcode = '22023';
  end if;
  get diagnostics changed = row_count;
  return changed > 0;
end;
$$;

comment on function public.email_unsubscribe(uuid, text) is
  'Turns off one marketing email (new-games or weekly-recap) for one account. Called by the notifications service after it verifies a signed unsubscribe link.';

revoke all on function public.email_unsubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.email_unsubscribe(uuid, text) to service_role;
