-- Direct messages: one conversation between two players.
--
-- Reads are ordinary selects under RLS, limited to the caller's own conversations.
-- There are no write grants at all: every write goes through a function below,
-- because the rules for sending (blocks, who may start a chat, rate limits) can't be
-- expressed as a policy, and a body must not be able to name its own sender or time.
--
-- Staff have no read path, and no admin function touches these tables. A report names
-- the account (see reports.target_kind = 'profile'), not the conversation.
--
-- Deleting an account deletes its conversations, by cascade, for both players.
--
-- Live delivery is through Supabase Realtime (ADR 0014). A signal says only "this chat
-- changed": no message text ever goes through it, because Realtime keeps what it sends
-- for days, and an unsent message has to be gone. The client then reads under RLS, so
-- a block or a deleted chat can't be sidestepped through the socket.
--
-- APPLY ORDER: after 20261215120000, and before the client. Preference saves send the
-- three new columns and fail without them.

-- Preferences -----------------------------------------------------------------

alter table public.user_preferences
  add column if not exists notify_messages boolean not null default true,
  add column if not exists allow_messages_from text not null default 'friends',
  add column if not exists show_read_receipts boolean not null default true;

alter table public.user_preferences
  drop constraint if exists user_preferences_allow_messages_from_check;
alter table public.user_preferences
  add constraint user_preferences_allow_messages_from_check
  check (allow_messages_from in ('everyone', 'friends', 'nobody'));

comment on column public.user_preferences.allow_messages_from is
  'Who can start a conversation with this player: everyone, friends (each follows the other), or nobody. Someone they have already messaged can always reply.';

comment on column public.user_preferences.show_read_receipts is
  'Whether "Seen" works in this player''s chats. It goes both ways: off, nobody sees when they have read, and they don''t see it for others.';

-- Tables ----------------------------------------------------------------------

-- The ordered pair makes one conversation per two players a constraint, not a habit.
create table if not exists public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_low        uuid not null references auth.users (id) on delete cascade,
  user_high       uuid not null references auth.users (id) on delete cascade,
  created_by      uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default clock_timestamp(),
  last_message_at timestamptz,
  constraint conversations_pair_ordered check (user_low < user_high),
  constraint conversations_pair_key unique (user_low, user_high),
  constraint conversations_creator_in_pair check (created_by in (user_low, user_high))
);

create index if not exists conversations_user_high_idx on public.conversations (user_high);
create index if not exists conversations_created_by_idx
  on public.conversations (created_by, created_at desc);

-- Each player's own view of a conversation. `cleared_at` is "delete this chat": it
-- hides what came before it from this player only.
create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  last_read_at    timestamptz,
  cleared_at      timestamptz,
  primary key (conversation_id, user_id)
);

create index if not exists conversation_participants_user_idx
  on public.conversation_participants (user_id);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  body            text not null,
  -- Chosen by the sending device, so a retry after a lost response can't send twice.
  client_id       uuid not null,
  created_at      timestamptz not null default clock_timestamp(),
  constraint messages_body_length check (char_length(body) between 1 and 2000),
  constraint messages_client_key unique (sender_id, client_id)
);

create index if not exists messages_conversation_idx
  on public.messages (conversation_id, created_at desc, id desc);
create index if not exists messages_sender_idx
  on public.messages (sender_id, created_at desc);

-- Grants and policies ---------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

revoke all on public.conversations from public, anon, authenticated;
revoke all on public.conversation_participants from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;

grant select (id, user_low, user_high, created_at, last_message_at)
  on public.conversations to authenticated;
grant select (conversation_id, user_id, last_read_at, cleared_at)
  on public.conversation_participants to authenticated;
-- Not `client_id`: it is the sender's device's business.
grant select (id, conversation_id, sender_id, body, created_at)
  on public.messages to authenticated;

grant all on public.conversations to service_role;
grant all on public.conversation_participants to service_role;
grant all on public.messages to service_role;

drop policy if exists conversations_select_own on public.conversations;
create policy conversations_select_own
  on public.conversations for select to authenticated
  using ((select auth.uid()) in (user_low, user_high));

drop policy if exists conversation_participants_select_own on public.conversation_participants;
create policy conversation_participants_select_own
  on public.conversation_participants for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own
  on public.messages for select to authenticated
  using (
    exists (
      select 1 from public.conversation_participants p
       where p.conversation_id = messages.conversation_id
         and p.user_id = (select auth.uid())
         and (p.cleared_at is null or messages.created_at > p.cleared_at)
    )
  );

-- Who may message whom --------------------------------------------------------

-- A block in either direction, a suspended account or a missing one all answer the
-- same `false`, so the sender can't tell a block from a privacy setting.
create or replace function public.messaging_allowed(p_sender uuid, p_recipient uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_sender <> p_recipient
     and exists (select 1 from public.profiles s where s.id = p_sender and not s.is_suspended)
     and exists (select 1 from public.profiles r where r.id = p_recipient and not r.is_suspended)
     and not exists (
       select 1 from public.blocked_users b
        where (b.blocker_id = p_recipient and b.blocked_id = p_sender)
           or (b.blocker_id = p_sender and b.blocked_id = p_recipient)
     )
     and (
       -- The setting is about starting a chat. Once the recipient has written in this
       -- conversation, the other player may answer; a block is how to end that.
       exists (
         select 1
           from public.messages m
           join public.conversations c on c.id = m.conversation_id
          where m.sender_id = p_recipient
            and c.user_low = least(p_sender, p_recipient)
            and c.user_high = greatest(p_sender, p_recipient)
       )
       or case coalesce((
            select up.allow_messages_from from public.user_preferences up
             where up.user_id = p_recipient
          ), 'friends')
            when 'everyone' then true
            when 'friends' then
              exists (
                select 1 from public.follows f
                 where f.follower_id = p_recipient and f.followee_id = p_sender
              )
              and exists (
                select 1 from public.follows f
                 where f.follower_id = p_sender and f.followee_id = p_recipient
              )
            else false
          end
     );
$$;

revoke all on function public.messaging_allowed(uuid, uuid) from public, anon, authenticated;

-- Notifications follow the same shared rules as every other kind.
create or replace function public.notification_wanted(
  p_recipient uuid,
  p_actor     uuid,
  p_kind      text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_recipient <> p_actor
     and not exists (
       select 1 from public.blocked_users b
        where (b.blocker_id = p_recipient and b.blocked_id = p_actor)
           or (b.blocker_id = p_actor and b.blocked_id = p_recipient)
     )
     and coalesce((
       select case p_kind
                when 'follow'  then up.notify_followers
                when 'comment' then up.notify_comments
                when 'score'   then up.notify_beats
                when 'message' then up.notify_messages
              end
         from public.user_preferences up
        where up.user_id = p_recipient
     ), true);
$$;

revoke all on function public.notification_wanted(uuid, uuid, text) from public, anon, authenticated;

-- Live signals ----------------------------------------------------------------

-- Tells one player's devices that a chat changed. A database without Realtime sends
-- nothing and clients fall back to polling, and a signal must never break the write it
-- reports. Carries no text; see the top of this file.
create or replace function public.dm_signal(p_user uuid, p_conversation uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    return;
  end if;
  perform realtime.send(
    jsonb_build_object('conversation_id', p_conversation, 'kind', p_kind),
    'changed',
    'dm:user:' || p_user::text,
    true
  );
exception when others then
  raise warning 'dm_signal failed: %', sqlerrm;
end;
$$;

revoke all on function public.dm_signal(uuid, uuid, text) from public, anon, authenticated;

-- "Seen" works only between two players who both have it on.
create or replace function public.dm_receipts_shared(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.user_preferences up
     where up.user_id in (p_one, p_two) and not up.show_read_receipts
  );
$$;

revoke all on function public.dm_receipts_shared(uuid, uuid) from public, anon, authenticated;

-- Sending ---------------------------------------------------------------------

-- Answers with an outcome the client reads, rather than raising:
--   sent          stored, or already stored under this client_id
--   invalid       an empty or over-long body, no client_id, or no usable recipient
--   suspended     the sender's account is suspended
--   rate_limited  30 messages a minute, or 30 new conversations a day
--   not_allowed   a block, the recipient's setting, or no such account
create or replace function public.send_direct_message(
  p_recipient uuid,
  p_body      text,
  p_client_id uuid
)
returns table (outcome text, message_id uuid, conversation_id uuid, sent_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_sender       uuid := auth.uid();
  v_body         text := regexp_replace(coalesce(p_body, ''), '^\s+|\s+$', '', 'g');
  v_low          uuid;
  v_high         uuid;
  v_conversation uuid;
  v_message      uuid;
  v_at           timestamptz;
  v_username     text;
begin
  if v_sender is null then
    raise exception 'sending a message needs a signed-in account' using errcode = '42501';
  end if;

  if p_recipient is null or p_recipient = v_sender or p_client_id is null
     or char_length(v_body) not between 1 and 2000 then
    return query select 'invalid'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  -- A retry of something already stored is the same success, whatever has changed
  -- since: the first attempt was allowed, and its response was only lost.
  select m.id, m.conversation_id, m.created_at into v_message, v_conversation, v_at
    from public.messages m
   where m.sender_id = v_sender and m.client_id = p_client_id;
  if v_message is not null then
    return query select 'sent'::text, v_message, v_conversation, v_at;
    return;
  end if;

  if exists (select 1 from public.profiles p where p.id = v_sender and p.is_suspended) then
    return query select 'suspended'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if (select count(*) from public.messages m
       where m.sender_id = v_sender
         and m.created_at > clock_timestamp() - interval '1 minute') >= 30 then
    return query select 'rate_limited'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  if not public.messaging_allowed(v_sender, p_recipient) then
    return query select 'not_allowed'::text, null::uuid, null::uuid, null::timestamptz;
    return;
  end if;

  v_low := least(v_sender, p_recipient);
  v_high := greatest(v_sender, p_recipient);

  select c.id into v_conversation
    from public.conversations c
   where c.user_low = v_low and c.user_high = v_high;

  if v_conversation is null then
    if (select count(*) from public.conversations c
         where c.created_by = v_sender
           and c.created_at > clock_timestamp() - interval '1 day') >= 30 then
      return query select 'rate_limited'::text, null::uuid, null::uuid, null::timestamptz;
      return;
    end if;

    insert into public.conversations (user_low, user_high, created_by)
    values (v_low, v_high, v_sender)
    on conflict (user_low, user_high) do nothing;

    -- Whoever won a simultaneous first message, there is one row to read now.
    select c.id into v_conversation
      from public.conversations c
     where c.user_low = v_low and c.user_high = v_high;
  end if;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conversation, v_sender), (v_conversation, p_recipient)
  on conflict (conversation_id, user_id) do nothing;

  insert into public.messages (conversation_id, sender_id, body, client_id)
  values (v_conversation, v_sender, v_body, p_client_id)
  on conflict (sender_id, client_id) do nothing
  returning id, created_at into v_message, v_at;

  if v_message is null then
    select m.id, m.created_at into v_message, v_at
      from public.messages m
     where m.sender_id = v_sender and m.client_id = p_client_id;
    return query select 'sent'::text, v_message, v_conversation, v_at;
    return;
  end if;

  update public.conversations c
     set last_message_at = greatest(c.last_message_at, v_at)
   where c.id = v_conversation;

  -- Answering a chat means having read it.
  update public.conversation_participants p
     set last_read_at = greatest(p.last_read_at, v_at)
   where p.conversation_id = v_conversation and p.user_id = v_sender;

  -- One notification per unread stretch: a burst of messages wakes a phone once, and
  -- reading the chat re-arms it. No message text: a push is shown on a lock screen.
  -- A notification must never break the message it reports.
  begin
    if public.notification_wanted(p_recipient, v_sender, 'message')
       and not exists (
         select 1 from public.notifications n
          where n.user_id = p_recipient
            and n.kind = 'message'
            and n.read_at is null
            and n.payload->>'conversation_id' = v_conversation::text
       ) then
      select p.username::text into v_username from public.profiles p where p.id = v_sender;
      insert into public.notifications (user_id, kind, payload)
      values (
        p_recipient,
        'message',
        jsonb_build_object(
          'actor_id', v_sender,
          'username', v_username,
          'conversation_id', v_conversation
        )
      );
    end if;
  exception when others then
    raise warning 'send_direct_message notification failed: %', sqlerrm;
  end;

  perform public.dm_signal(p_recipient, v_conversation, 'message');
  perform public.dm_signal(v_sender, v_conversation, 'message');

  return query select 'sent'::text, v_message, v_conversation, v_at;
end;
$$;

revoke all on function public.send_direct_message(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.send_direct_message(uuid, text, uuid) to authenticated;

-- Reading ---------------------------------------------------------------------

-- The caller's chats, newest first, capped at the latest 100. Runs as the caller, so
-- RLS decides what it can see. A chat with someone the caller blocked is left out and
-- comes back on unblocking. The other side still sees it, so a block isn't announced.
create or replace function public.direct_inbox()
returns table (
  conversation_id uuid,
  other_id        uuid,
  username        text,
  display_name    text,
  avatar_path     text,
  last_body       text,
  last_sender_id  uuid,
  last_at         timestamptz,
  unread_count    integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    c.id,
    o.id,
    pr.username::text,
    pr.display_name,
    pr.avatar_path,
    l.body,
    l.sender_id,
    l.created_at,
    u.n::integer
  from public.conversation_participants me
  join public.conversations c on c.id = me.conversation_id
  cross join lateral (
    select case when c.user_low = me.user_id then c.user_high else c.user_low end as id
  ) o
  join public.profiles pr on pr.id = o.id
  cross join lateral (
    select m.body, m.sender_id, m.created_at
      from public.messages m
     where m.conversation_id = c.id
     order by m.created_at desc, m.id desc
     limit 1
  ) l
  cross join lateral (
    select count(*) as n from (
      select 1 from public.messages m
       where m.conversation_id = c.id
         and m.sender_id = o.id
         and (me.last_read_at is null or m.created_at > me.last_read_at)
       limit 100
    ) capped
  ) u
  where me.user_id = (select auth.uid())
    and not exists (
      select 1 from public.blocked_users b
       where b.blocker_id = me.user_id and b.blocked_id = o.id
    )
  order by l.created_at desc
  limit 100;
$$;

revoke all on function public.direct_inbox() from public, anon, authenticated;
grant execute on function public.direct_inbox() to authenticated;

-- How many chats have something unread: the number on the navigation badge.
create or replace function public.direct_unread_total()
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
    from public.conversation_participants me
    join public.conversations c on c.id = me.conversation_id
   where me.user_id = (select auth.uid())
     and exists (
       select 1 from public.messages m
        where m.conversation_id = c.id
          and m.sender_id <> me.user_id
          and (me.last_read_at is null or m.created_at > me.last_read_at)
     )
     and not exists (
       select 1 from public.blocked_users b
        where b.blocker_id = me.user_id
          and b.blocked_id in (c.user_low, c.user_high)
     );
$$;

revoke all on function public.direct_unread_total() from public, anon, authenticated;
grant execute on function public.direct_unread_total() to authenticated;

-- What a chat screen needs besides the messages: the conversation, whether the caller
-- can write in it, and how far the other player has read. Always one row. Security
-- definer because the other player's row and the sending rules aren't the caller's
-- to read; `can_send` says no more than trying to send would. The read position is
-- withheld unless both players have "Seen" on.
create or replace function public.direct_thread(p_other uuid)
returns table (conversation_id uuid, can_send boolean, their_last_read_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me           uuid := auth.uid();
  v_conversation uuid;
  v_read         timestamptz;
begin
  if v_me is null then
    raise exception 'reading a chat needs a signed-in account' using errcode = '42501';
  end if;

  select c.id into v_conversation
    from public.conversations c
   where c.user_low = least(v_me, p_other) and c.user_high = greatest(v_me, p_other);

  if v_conversation is not null and public.dm_receipts_shared(v_me, p_other) then
    select p.last_read_at into v_read
      from public.conversation_participants p
     where p.conversation_id = v_conversation and p.user_id = p_other;
  end if;

  return query select
    v_conversation,
    coalesce(public.messaging_allowed(v_me, p_other), false),
    v_read;
end;
$$;

revoke all on function public.direct_thread(uuid) from public, anon, authenticated;
grant execute on function public.direct_thread(uuid) to authenticated;

-- Writing the caller's own view -----------------------------------------------

-- Reads up to the newest stored message rather than the clock, so a message committed
-- a moment later still counts as unread. Only ever the caller's own row.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_other uuid;
begin
  if v_me is null then
    raise exception 'reading a chat needs a signed-in account' using errcode = '42501';
  end if;

  update public.conversation_participants p
     set last_read_at = greatest(p.last_read_at, (
           select max(m.created_at) from public.messages m
            where m.conversation_id = p_conversation
         ))
   where p.conversation_id = p_conversation and p.user_id = v_me;

  if found then
    update public.notifications n
       set read_at = now()
     where n.user_id = v_me
       and n.kind = 'message'
       and n.read_at is null
       and n.payload->>'conversation_id' = p_conversation::text;

    -- This player's other devices clear their badge. The other player hears only if
    -- "Seen" is on: the signal's timing would otherwise give it away.
    perform public.dm_signal(v_me, p_conversation, 'read');
    select case when c.user_low = v_me then c.user_high else c.user_low end into v_other
      from public.conversations c where c.id = p_conversation;
    if public.dm_receipts_shared(v_me, v_other) then
      perform public.dm_signal(v_other, p_conversation, 'read');
    end if;
  end if;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- "Delete this chat": gone from the caller's inbox and history, untouched for the
-- other player, and a later message starts it afresh.
create or replace function public.clear_conversation(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_at timestamptz := clock_timestamp();
begin
  if v_me is null then
    raise exception 'deleting a chat needs a signed-in account' using errcode = '42501';
  end if;

  update public.conversation_participants p
     set cleared_at = v_at,
         last_read_at = v_at
   where p.conversation_id = p_conversation and p.user_id = v_me;

  if found then
    update public.notifications n
       set read_at = now()
     where n.user_id = v_me
       and n.kind = 'message'
       and n.read_at is null
       and n.payload->>'conversation_id' = p_conversation::text;
    perform public.dm_signal(v_me, p_conversation, 'cleared');
  end if;
end;
$$;

revoke all on function public.clear_conversation(uuid) from public, anon, authenticated;
grant execute on function public.clear_conversation(uuid) to authenticated;

-- Takes a message back, for both players, at any time. The row is deleted rather than
-- marked, so the text really is gone and no trace is left in the chat. Answers whether
-- anything was removed: only the sender's own message can be.
--
-- Its notification stays as it was. A push already sent can't be recalled, and clearing
-- the row would let send-and-unsend buzz someone's phone over and over.
create or replace function public.unsend_direct_message(p_message uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me           uuid := auth.uid();
  v_conversation uuid;
  v_low          uuid;
  v_high         uuid;
begin
  if v_me is null then
    raise exception 'unsending a message needs a signed-in account' using errcode = '42501';
  end if;

  delete from public.messages m
   where m.id = p_message and m.sender_id = v_me
  returning m.conversation_id into v_conversation;

  if v_conversation is null then
    return false;
  end if;

  update public.conversations c
     set last_message_at = (
           select max(m.created_at) from public.messages m
            where m.conversation_id = c.id
         )
   where c.id = v_conversation
  returning c.user_low, c.user_high into v_low, v_high;

  perform public.dm_signal(v_low, v_conversation, 'unsend');
  perform public.dm_signal(v_high, v_conversation, 'unsend');
  return true;
end;
$$;

revoke all on function public.unsend_direct_message(uuid) from public, anon, authenticated;
grant execute on function public.unsend_direct_message(uuid) to authenticated;

-- Push ------------------------------------------------------------------------

-- Restated to let `message` through. The sender words it; see
-- services/notifications/push.go.
create or replace function public.claim_push_batch(p_limit integer)
returns table (
  notification_id uuid,
  kind            text,
  payload         jsonb,
  subscription_id uuid,
  endpoint        text,
  p256dh          text,
  auth            text,
  language        text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Yesterday's news is not worth waking a phone for, if the sender was down.
  update public.notifications n
     set push_sent_at = now()
   where n.push_sent_at is null
     and n.created_at <= now() - interval '1 day';

  return query
  with claimed as (
    update public.notifications n
       set push_sent_at = now()
     where n.id in (
       select p.id from public.notifications p
        where p.push_sent_at is null
        order by p.created_at
        limit greatest(1, least(coalesce(p_limit, 100), 200))
        for update skip locked
     )
    returning n.id, n.kind, n.payload, n.user_id
  )
  select c.id, c.kind::text, c.payload, s.id, s.endpoint, s.p256dh, s.auth, s.language
    from claimed c
    join public.push_subscriptions s on s.user_id = c.user_id
   where c.kind in ('follow', 'comment', 'score', 'message');
end;
$$;

revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

drop trigger if exists notifications_wake_push on public.notifications;
create trigger notifications_wake_push
  after insert on public.notifications
  for each row
  when (new.kind in ('follow', 'comment', 'score', 'message'))
  execute function public.wake_push_dispatch();

-- Who may listen and who may speak on Realtime --------------------------------

-- A topic for one conversation carries typing indicators, which never touch a table.
-- Only its two players, not suspended, with no block between them.
create or replace function public.dm_conversation_topic_allowed(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.conversation_participants p
      join public.conversations c on c.id = p.conversation_id
      join public.profiles me on me.id = p.user_id
     where p.user_id = (select auth.uid())
       and p_topic = 'dm:conv:' || c.id::text
       and not me.is_suspended
       and not exists (
         select 1 from public.blocked_users b
          where (b.blocker_id = c.user_low and b.blocked_id = c.user_high)
             or (b.blocker_id = c.user_high and b.blocked_id = c.user_low)
       )
  );
$$;

revoke all on function public.dm_conversation_topic_allowed(text) from public, anon;
grant execute on function public.dm_conversation_topic_allowed(text) to authenticated;

-- Conditional, so this also applies to a database without Realtime. A player reads
-- their own signal topic and can't write to it: only the functions above can.
do $do$
begin
  if to_regclass('realtime.messages') is null then
    return;
  end if;

  drop policy if exists dm_realtime_listen on realtime.messages;
  create policy dm_realtime_listen
    on realtime.messages for select to authenticated
    using (
      extension = 'broadcast'
      and (
        (select realtime.topic()) = 'dm:user:' || (select auth.uid())::text
        or public.dm_conversation_topic_allowed((select realtime.topic()))
      )
    );

  drop policy if exists dm_realtime_typing on realtime.messages;
  create policy dm_realtime_typing
    on realtime.messages for insert to authenticated
    with check (
      extension = 'broadcast'
      and public.dm_conversation_topic_allowed((select realtime.topic()))
    );
end $do$;
