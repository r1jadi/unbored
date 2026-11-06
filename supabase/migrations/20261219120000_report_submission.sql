-- Reporting a player, a comment or a game, from anywhere in the app.
--
-- `public.reports` and the moderators' queue already exist. What was missing is a
-- single way in: the profile menu only told people to open an issue, comments had no
-- report at all, and the chat menu wrote a bare row with no reason.
--
-- `submit_report` is that way in. It checks the target exists, refuses a report of
-- yourself, answers with the existing report when this player already has one open on
-- the same target, and limits how many a player can file in a day, so the queue can't
-- be flooded from one account.
--
-- A report from a chat can carry the reported player's last few messages. Moderators
-- have no other way to read a private conversation, so without them such a report is
-- impossible to judge. They are copied by the database from the conversation itself
-- rather than taken from the request, so they can't be invented, and only when the
-- reporter is one of its two players. The report dialog says this before it is sent.
--
-- Apply before the client: the report dialog calls this function.

create or replace function public.submit_report(
  p_target_kind      public.report_target,
  p_target_id        uuid,
  p_reason           text,
  p_details          text default null,
  p_include_messages boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reporter uuid := auth.uid();
  v_reason   text := btrim(coalesce(p_reason, ''));
  v_details  text := nullif(btrim(coalesce(p_details, '')), '');
  v_existing uuid;
  v_recent   integer;
  v_evidence text;
  v_id       uuid;
begin
  if v_reporter is null then
    raise exception 'a report needs a signed-in account' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 3 and 80 then
    raise exception 'a report needs a reason' using errcode = '22023';
  end if;
  if v_details is not null and char_length(v_details) > 500 then
    raise exception 'report details are too long' using errcode = '22023';
  end if;

  case p_target_kind
    when 'profile' then
      if p_target_id = v_reporter then
        raise exception 'you cannot report yourself' using errcode = '22023';
      end if;
      perform 1 from public.profiles p where p.id = p_target_id;
    when 'comment' then
      perform 1 from public.comments c
       where c.id = p_target_id and c.author_id <> v_reporter;
    when 'game' then
      perform 1 from public.games g where g.id = p_target_id;
  end case;
  if not found then
    raise exception 'that can no longer be reported' using errcode = 'P0002';
  end if;

  -- Reporting the same thing twice is one report: the second tap succeeds quietly.
  select r.id into v_existing
    from public.reports r
   where r.reporter_id = v_reporter
     and r.target_kind = p_target_kind
     and r.target_id = p_target_id
     and r.status in ('open', 'reviewing')
   limit 1;
  if v_existing is not null then
    return v_existing;
  end if;

  select count(*) into v_recent
    from public.reports r
   where r.reporter_id = v_reporter
     and r.created_at > now() - interval '1 day';
  if v_recent >= 30 then
    raise exception 'too many reports today' using errcode = '53400';
  end if;

  if p_include_messages and p_target_kind = 'profile' then
    select string_agg(m.body, ' | ' order by m.created_at) into v_evidence
      from (
        select msg.body, msg.created_at
          from public.messages msg
          join public.conversations c on c.id = msg.conversation_id
         where msg.sender_id = p_target_id
           and least(v_reporter, p_target_id) = c.user_low
           and greatest(v_reporter, p_target_id) = c.user_high
         order by msg.created_at desc
         limit 5
      ) m;
  end if;

  if v_evidence is not null then
    v_details := left(
      coalesce(v_details || E'\n', '') || 'Recent messages: ' || v_evidence,
      1000
    );
  end if;

  insert into public.reports (reporter_id, target_kind, target_id, reason, details)
  values (v_reporter, p_target_kind, p_target_id, v_reason, v_details)
  returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.submit_report(public.report_target, uuid, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_report(public.report_target, uuid, text, text, boolean)
  to authenticated;

comment on function public.submit_report(public.report_target, uuid, text, text, boolean) is
  'Files one report for the moderation queue: validated, idempotent per open target, and limited per day. Chat evidence is copied from the conversation, never taken from the request.';
