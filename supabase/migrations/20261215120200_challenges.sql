-- Callouts (`challenges` in the schema): two friends, one game, the exact same board,
-- just for fun.
--
-- A callout lives in a chat as a card. It has a shared seed, so nobody can blame luck,
-- and one attempt each. There are three formats:
--
--   sealed         the friend accepts, both play, and neither sees a score until both
--                  have one (or the time is up).
--   beat_my_score  the challenger plays first, in private. Only then does the friend
--                  see the card, with the score to beat.
--   score_target   "I'll score at least 10,000." The friend accepts, and only the
--                  challenger plays.
--
-- The first two can carry a margin: "I'll score 100 more than you". Then the challenger
-- has to win by that much, and anything less goes to the friend. With no margin, the
-- higher score wins and a tie is a draw.
--
-- Scores come from the same verifiers as every other run: this adds nothing a client
-- can claim. They stay off the boards (a trigger on `scores`), because two people
-- sharing a seed could trade moves, and a board shouldn't reward that.
--
-- One attempt means one: a challenge run can't be saved or continued, so nobody can
-- stop a clock to think or look at a board and come back. Leaving without finishing
-- leaves no score.
--
-- Time limits are settled when someone next looks (`conversation_challenges`), since
-- nothing else runs on a schedule. A result can land a little late; it can't be wrong.
--
-- Double or nothing: the loser may stake their loss on a rematch. Win it and the
-- original loss is wiped. Lose it and it counts as a second loss, and the badge lasts
-- 48 hours instead of 24. A double can't be doubled.
--
-- No client grants: every read and write is a function below.
--
-- APPLY ORDER: after 20261215120100, and before the client.

create table if not exists public.challenges (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.conversations (id) on delete cascade,
  challenger_id      uuid not null references auth.users (id) on delete cascade,
  opponent_id        uuid not null references auth.users (id) on delete cascade,
  user_low           uuid not null,
  user_high          uuid not null,
  game_id            uuid not null references public.games (id) on delete cascade,
  format             text not null,
  status             text not null,
  -- Shared by both runs. Never sent to anyone until their own run starts.
  seed               bigint not null default (floor(random() * 9223372036854775807)::bigint),
  rules_version      text,
  stake              text,
  margin             bigint not null default 0,
  target_score       bigint,
  rematch_of         uuid references public.challenges (id) on delete set null,
  is_double          boolean not null default false,
  challenger_session uuid,
  opponent_session   uuid,
  challenger_score   bigint,
  opponent_score     bigint,
  winner_id          uuid references auth.users (id) on delete cascade,
  created_at         timestamptz not null default clock_timestamp(),
  respond_by         timestamptz,
  play_by            timestamptz,
  finished_at        timestamptz,
  constraint challenges_two_players check (challenger_id <> opponent_id),
  constraint challenges_format check (format in ('sealed', 'beat_my_score', 'score_target')),
  constraint challenges_margin check (margin between 0 and 1000000000),
  constraint challenges_target check (
    (format = 'score_target') = (target_score is not null)
    and (target_score is null or target_score between 1 and 1000000000000)
  ),
  constraint challenges_target_no_margin check (format <> 'score_target' or margin = 0),
  constraint challenges_status check (
    status in ('draft', 'pending', 'active', 'finished', 'declined', 'cancelled', 'expired')
  ),
  constraint challenges_stake_length check (stake is null or char_length(stake) between 1 and 80),
  constraint challenges_pair_ordered check (user_low < user_high),
  constraint challenges_double_is_rematch check (not is_double or rematch_of is not null)
);

-- One at a time per game per pair, and one rematch per challenge.
create unique index if not exists challenges_one_open_idx
  on public.challenges (user_low, user_high, game_id)
  where status in ('draft', 'pending', 'active');
create unique index if not exists challenges_one_rematch_idx
  on public.challenges (rematch_of) where rematch_of is not null;
create index if not exists challenges_conversation_idx
  on public.challenges (conversation_id, created_at desc);
create index if not exists challenges_challenger_idx
  on public.challenges (challenger_id, created_at desc);
create index if not exists challenges_opponent_idx on public.challenges (opponent_id);

alter table public.challenges enable row level security;
revoke all on public.challenges from public, anon, authenticated;
grant all on public.challenges to service_role;

alter table public.game_sessions
  add column if not exists challenge_id uuid references public.challenges (id) on delete set null;
create index if not exists game_sessions_challenge_idx
  on public.game_sessions (challenge_id) where challenge_id is not null;

-- A card in the chat is a message that points at its challenge.
alter table public.messages
  add column if not exists challenge_id uuid references public.challenges (id) on delete cascade;
create unique index if not exists messages_one_card_idx
  on public.messages (challenge_id) where challenge_id is not null;
grant select (challenge_id) on public.messages to authenticated;

-- Runs stay what they are -------------------------------------------------------

-- A challenge score is the challenge's, not the board's. Every verifier inserts its
-- score the same way and reads nothing back, so skipping the row here covers them all.
create or replace function public.scores_skip_challenge_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.game_sessions s
     where s.id = new.session_id and s.challenge_id is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke all on function public.scores_skip_challenge_runs() from public, anon, authenticated;

drop trigger if exists scores_skip_challenge_runs on public.scores;
create trigger scores_skip_challenge_runs
  before insert on public.scores
  for each row execute function public.scores_skip_challenge_runs();

-- One attempt: no saved moves, nothing to continue, and starting an ordinary run of
-- the same game in another tab doesn't throw this one away.
create or replace function public.game_sessions_guard_challenge()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.challenge_id is null then
    return new;
  end if;
  new.abandoned_at := old.abandoned_at;
  new.progress_actions := null;
  new.progress_saved_at := null;
  new.continuable := false;
  return new;
end;
$$;

revoke all on function public.game_sessions_guard_challenge() from public, anon, authenticated;

drop trigger if exists game_sessions_guard_challenge on public.game_sessions;
create trigger game_sessions_guard_challenge
  before update on public.game_sessions
  for each row execute function public.game_sessions_guard_challenge();

-- Restated so a challenge run doesn't count as "something newer" and hide an ordinary
-- ended run that could still be continued.
create or replace function public.saved_run(
  p_game_slug     text,
  p_rules_version text
)
returns table (
  session_id    uuid,
  game_slug     text,
  rules_version text,
  seed          text,
  started_at    timestamptz,
  expires_at    timestamptz,
  actions       integer[],
  played_ms     integer,
  saved_at      timestamptz,
  already_scored boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.id, g.slug::text, s.rules_version, s.seed::text, s.started_at, s.expires_at,
         s.progress_actions,
         public.run_played_ms(s.progress_saved_at, s.started_at),
         s.progress_saved_at,
         s.completed_at is not null
    from public.game_sessions s
    join public.games g on g.id = s.game_id
   where s.user_id = auth.uid()
     and s.challenge_id is null
     and g.slug = p_game_slug
     and s.rules_version = p_rules_version
     and public.run_resumable(s.rules_version)
     and s.abandoned_at is null
     and coalesce(array_length(s.progress_actions, 1), 0) > 0
     and (
       (s.completed_at is null and s.expires_at > now())
       or (
         s.completed_at is not null
         and s.continuable
         and s.completed_at > now() - interval '30 days'
         and not exists (
           select 1 from public.game_sessions newer
            where newer.game_id = s.game_id
              and newer.user_id = s.user_id
              and newer.id <> s.id
              and newer.challenge_id is null
              and newer.started_at > s.completed_at
         )
       )
     )
   order by s.completed_at is null desc, s.progress_saved_at desc
   limit 1
$$;

-- Helpers -----------------------------------------------------------------------

-- Each follows the other. The same meaning of "friends" as everywhere else.
create or replace function public.challenge_friends(p_one uuid, p_two uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.follows f
            where f.follower_id = p_one and f.followee_id = p_two
         )
     and exists (
           select 1 from public.follows f
            where f.follower_id = p_two and f.followee_id = p_one
         );
$$;

revoke all on function public.challenge_friends(uuid, uuid) from public, anon, authenticated;

-- Tells a player, unless they turned message notifications off. Unlike a plain message
-- each of these is news of its own, and the limit on creating them keeps that in check.
create or replace function public.challenge_notify(
  p_recipient uuid,
  p_actor     uuid,
  p_id        uuid,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_title    text;
  v_conv     uuid;
begin
  if not public.notification_wanted(p_recipient, p_actor, 'message') then
    return;
  end if;
  select p.username::text into v_username from public.profiles p where p.id = p_actor;
  select g.title, c.conversation_id into v_title, v_conv
    from public.challenges c
    join public.games g on g.id = c.game_id
   where c.id = p_id;
  insert into public.notifications (user_id, kind, payload)
  values (
    p_recipient,
    'message',
    jsonb_build_object(
      'actor_id', p_actor,
      'username', v_username,
      'conversation_id', v_conv,
      'reason', p_reason,
      'game_title', v_title
    )
  );
exception when others then
  raise warning 'challenge_notify failed: %', sqlerrm;
end;
$$;

revoke all on function public.challenge_notify(uuid, uuid, uuid, text) from public, anon, authenticated;

-- Puts the card at the bottom of the chat: a new message, so it counts as unread for
-- the other player, and the old position goes. `p_actor` is who it reads as sent by.
create or replace function public.challenge_post(p_id uuid, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv uuid;
  v_at   timestamptz;
begin
  select c.conversation_id into v_conv from public.challenges c where c.id = p_id;

  delete from public.messages m where m.challenge_id = p_id;

  insert into public.messages (conversation_id, sender_id, body, client_id, challenge_id)
  values (v_conv, p_actor, '⚔️', gen_random_uuid(), p_id)
  returning created_at into v_at;

  update public.conversations c
     set last_message_at = greatest(c.last_message_at, v_at)
   where c.id = v_conv;

  update public.conversation_participants p
     set last_read_at = greatest(p.last_read_at, v_at)
   where p.conversation_id = v_conv and p.user_id = p_actor;
end;
$$;

revoke all on function public.challenge_post(uuid, uuid) from public, anon, authenticated;

create or replace function public.challenge_signal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.challenges;
begin
  select * into v_c from public.challenges c where c.id = p_id;
  if found then
    perform public.dm_signal(v_c.challenger_id, v_c.conversation_id, 'challenge');
    perform public.dm_signal(v_c.opponent_id, v_c.conversation_id, 'challenge');
  end if;
end;
$$;

revoke all on function public.challenge_signal(uuid) from public, anon, authenticated;

-- Decides it from the scores it has. One score beats none, and none on either side
-- means nobody played, which is no result at all. A call has to come true: miss the
-- target, or win by less than the margin, and the friend wins.
create or replace function public.challenge_finish(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c      public.challenges;
  v_winner uuid;
  v_actor  uuid;
  v_other  uuid;
begin
  select * into v_c from public.challenges c where c.id = p_id for update;

  if v_c.format <> 'score_target'
     and v_c.challenger_score is null and v_c.opponent_score is null then
    update public.challenges c set status = 'expired', finished_at = clock_timestamp()
     where c.id = p_id;
    perform public.challenge_signal(p_id);
    return;
  end if;

  if v_c.format = 'score_target' then
    v_winner := case when coalesce(v_c.challenger_score, -1) >= v_c.target_score
                     then v_c.challenger_id else v_c.opponent_id end;
  elsif v_c.opponent_score is null then
    v_winner := v_c.challenger_id;
  elsif v_c.challenger_score is null then
    v_winner := v_c.opponent_id;
  elsif v_c.margin > 0 then
    v_winner := case when v_c.challenger_score >= v_c.opponent_score + v_c.margin
                     then v_c.challenger_id else v_c.opponent_id end;
  elsif v_c.challenger_score > v_c.opponent_score then
    v_winner := v_c.challenger_id;
  elsif v_c.opponent_score > v_c.challenger_score then
    v_winner := v_c.opponent_id;
  end if;

  update public.challenges c
     set status = 'finished', winner_id = v_winner, finished_at = clock_timestamp()
   where c.id = p_id;

  -- Whoever played last has just seen it, so the other player gets the unread card.
  if v_c.opponent_score is not null
     or (v_c.format = 'score_target' and v_c.challenger_score is null) then
    v_actor := v_c.opponent_id;
    v_other := v_c.challenger_id;
  else
    v_actor := v_c.challenger_id;
    v_other := v_c.opponent_id;
  end if;

  perform public.challenge_post(p_id, v_actor);
  perform public.challenge_notify(v_other, v_actor, p_id, 'challenge_result');
  perform public.challenge_signal(p_id);
end;
$$;

revoke all on function public.challenge_finish(uuid) from public, anon, authenticated;

-- Settling what ran out of time, for the caller's own challenges. A run begun just
-- before the deadline gets half an hour's grace to come back with its score.
create or replace function public.challenge_sweep(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  -- A beat-my-score nobody finished was never sent, so it leaves no trace.
  delete from public.challenges c
   where c.status = 'draft'
     and c.challenger_id = p_user
     and c.created_at < clock_timestamp() - interval '2 hours';

  for v_id in
    select c.id from public.challenges c
     where p_user in (c.challenger_id, c.opponent_id)
       and c.status = 'pending'
       and c.respond_by < clock_timestamp()
  loop
    update public.challenges c
       set status = 'expired', finished_at = clock_timestamp()
     where c.id = v_id;
    perform public.challenge_signal(v_id);
  end loop;

  for v_id in
    select c.id from public.challenges c
     where p_user in (c.challenger_id, c.opponent_id)
       and c.status = 'active'
       and c.play_by + interval '30 minutes' < clock_timestamp()
  loop
    perform public.challenge_finish(v_id);
  end loop;
end;
$$;

revoke all on function public.challenge_sweep(uuid) from public, anon, authenticated;

-- A verified score lands on its challenge, whichever verifier wrote it.
create or replace function public.challenge_record_run()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.challenges;
begin
  if new.challenge_id is null or new.verified_score is null or old.completed_at is not null then
    return new;
  end if;

  select * into v_c from public.challenges c where c.id = new.challenge_id for update;
  if not found or v_c.status not in ('draft', 'active') then
    return new;
  end if;

  if new.user_id = v_c.challenger_id then
    update public.challenges c set challenger_score = new.verified_score where c.id = v_c.id;
    if v_c.status = 'draft' then
      -- The score to beat exists now, so the friend finally sees the card.
      update public.challenges c
         set status = 'pending', respond_by = clock_timestamp() + interval '24 hours'
       where c.id = v_c.id;
      perform public.challenge_post(v_c.id, v_c.challenger_id);
      perform public.challenge_notify(v_c.opponent_id, v_c.challenger_id, v_c.id, 'challenge');
      perform public.challenge_signal(v_c.id);
      return new;
    end if;
  elsif new.user_id = v_c.opponent_id then
    update public.challenges c set opponent_score = new.verified_score where c.id = v_c.id;
  else
    return new;
  end if;

  select * into v_c from public.challenges c where c.id = v_c.id;
  if v_c.format = 'score_target'
     or (v_c.challenger_score is not null and v_c.opponent_score is not null) then
    perform public.challenge_finish(v_c.id);
  else
    perform public.challenge_signal(v_c.id);
  end if;
  return new;
exception when others then
  -- The run is verified either way. Time limits still settle the challenge.
  raise warning 'challenge_record_run failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.challenge_record_run() from public, anon, authenticated;

drop trigger if exists game_sessions_record_challenge on public.game_sessions;
create trigger game_sessions_record_challenge
  after update on public.game_sessions
  for each row
  when (new.challenge_id is not null and new.verified_score is not null)
  execute function public.challenge_record_run();

-- A block ends what is open, with no result. Unfollowing doesn't: that would be a way
-- out of a challenge you were about to lose.
create or replace function public.challenge_cancel_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    update public.challenges c
       set status = 'cancelled', finished_at = clock_timestamp()
     where c.status in ('draft', 'pending', 'active')
       and c.user_low = least(new.blocker_id, new.blocked_id)
       and c.user_high = greatest(new.blocker_id, new.blocked_id)
    returning c.id
  loop
    perform public.challenge_signal(v_id);
  end loop;
  return new;
exception when others then
  raise warning 'challenge_cancel_on_block failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.challenge_cancel_on_block() from public, anon, authenticated;

drop trigger if exists blocked_users_cancel_challenges on public.blocked_users;
create trigger blocked_users_cancel_challenges
  after insert on public.blocked_users
  for each row execute function public.challenge_cancel_on_block();

-- Making one --------------------------------------------------------------------

-- Answers with an outcome the client reads:
--   created         a sealed challenge is in the chat; a beat-my-score is waiting for
--                   its challenger to play, and the friend sees nothing yet
--   invalid         a bad format, margin or target, or a stake that is too long
--   suspended       the caller's account is suspended
--   not_friends     they don't follow each other
--   not_allowed     a block, or the friend's message setting
--   not_available   no such game, or one that can't be challenged (the daily games)
--   already_open    these two already have one going on this game
--   rematch_closed  that result can't be rematched by this player, or already was
--   rate_limited    ten new challenges a day
create or replace function public.create_challenge(
  p_opponent   uuid,
  p_game_slug  text,
  p_format     text,
  p_stake      text,
  p_rematch_of uuid,
  p_double     boolean,
  p_margin     bigint default 0,
  p_target     bigint default null
)
returns table (outcome text, challenge_id uuid, conversation_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me     uuid := auth.uid();
  v_stake  text := nullif(regexp_replace(coalesce(p_stake, ''), '^\s+|\s+$', '', 'g'), '');
  v_game   public.games;
  v_parent public.challenges;
  v_conv   uuid;
  v_low    uuid;
  v_high   uuid;
  v_id     uuid;
begin
  if v_me is null then
    raise exception 'a challenge needs a signed-in account' using errcode = '42501';
  end if;

  if p_opponent is null or p_opponent = v_me
     or p_format is null or p_format not in ('sealed', 'beat_my_score', 'score_target')
     or (v_stake is not null and char_length(v_stake) > 80)
     or coalesce(p_margin, 0) not between 0 and 1000000000
     or (p_format = 'score_target') <> (p_target is not null)
     or (p_target is not null and p_target not between 1 and 1000000000000)
     or (p_format = 'score_target' and coalesce(p_margin, 0) <> 0) then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if exists (select 1 from public.profiles p where p.id = v_me and p.is_suspended) then
    return query select 'suspended'::text, null::uuid, null::uuid;
    return;
  end if;

  if not public.challenge_friends(v_me, p_opponent) then
    return query select 'not_friends'::text, null::uuid, null::uuid;
    return;
  end if;

  if not public.messaging_allowed(v_me, p_opponent) then
    return query select 'not_allowed'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_game
    from public.games g
   where g.slug = p_game_slug
     and g.status = 'published'
     and g.playable
     and g.runtime is not null
     -- The day is the seed for these, and they are one attempt a day already.
     and g.runtime not in ('crossword', 'seven-second')
     and exists (select 1 from public.game_runtimes r where r.runtime = g.runtime);
  if not found then
    return query select 'not_available'::text, null::uuid, null::uuid;
    return;
  end if;

  if p_rematch_of is not null then
    select * into v_parent from public.challenges c where c.id = p_rematch_of;
    if not found
       or v_parent.status <> 'finished'
       or v_parent.game_id <> v_game.id
       or not (v_me in (v_parent.challenger_id, v_parent.opponent_id)
               and p_opponent in (v_parent.challenger_id, v_parent.opponent_id))
       or exists (select 1 from public.challenges r where r.rematch_of = p_rematch_of)
       or (coalesce(p_double, false) and (
             -- Only the loser can stake their loss, and only once.
             v_parent.is_double
             or v_parent.winner_id is null
             or v_parent.winner_id = v_me
           )) then
      return query select 'rematch_closed'::text, null::uuid, null::uuid;
      return;
    end if;
  elsif coalesce(p_double, false) then
    return query select 'invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  if (select count(*) from public.challenges c
       where c.challenger_id = v_me
         and c.created_at > clock_timestamp() - interval '1 day') >= 10 then
    return query select 'rate_limited'::text, null::uuid, null::uuid;
    return;
  end if;

  v_low := least(v_me, p_opponent);
  v_high := greatest(v_me, p_opponent);

  -- A beat-my-score the caller never played, on this game, gives way to this one.
  delete from public.challenges c
   where c.status = 'draft'
     and c.challenger_id = v_me
     and c.user_low = v_low and c.user_high = v_high
     and c.game_id = v_game.id
     and c.challenger_session is null;

  perform public.challenge_sweep(v_me);

  insert into public.conversations (user_low, user_high, created_by)
  values (v_low, v_high, v_me)
  on conflict (user_low, user_high) do nothing;

  select c.id into v_conv
    from public.conversations c
   where c.user_low = v_low and c.user_high = v_high;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv, v_me), (v_conv, p_opponent)
  on conflict (conversation_id, user_id) do nothing;

  begin
    insert into public.challenges (
      conversation_id, challenger_id, opponent_id, user_low, user_high, game_id, format,
      status, stake, margin, target_score, rematch_of, is_double, respond_by
    )
    values (
      v_conv, v_me, p_opponent, v_low, v_high, v_game.id, p_format,
      case when p_format = 'beat_my_score' then 'draft' else 'pending' end,
      v_stake, coalesce(p_margin, 0), p_target, p_rematch_of, coalesce(p_double, false),
      case when p_format = 'beat_my_score' then null else clock_timestamp() + interval '24 hours' end
    )
    returning id into v_id;
  exception when unique_violation then
    return query select 'already_open'::text, null::uuid, null::uuid;
    return;
  end;

  if p_format <> 'beat_my_score' then
    perform public.challenge_post(v_id, v_me);
    perform public.challenge_notify(p_opponent, v_me, v_id, 'challenge');
    perform public.challenge_signal(v_id);
  end if;

  return query select 'created'::text, v_id, v_conv;
end;
$$;

revoke all on function public.create_challenge(uuid, text, text, text, uuid, boolean, bigint, bigint) from public, anon, authenticated;
grant execute on function public.create_challenge(uuid, text, text, text, uuid, boolean, bigint, bigint) to authenticated;

-- The friend's answer. Only theirs, and only while it is open.
create or replace function public.respond_to_challenge(p_challenge uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_c  public.challenges;
begin
  if v_me is null then
    raise exception 'a challenge needs a signed-in account' using errcode = '42501';
  end if;
  perform public.challenge_sweep(v_me);

  select * into v_c from public.challenges c
   where c.id = p_challenge and c.opponent_id = v_me
   for update;
  if not found or v_c.status <> 'pending' then
    return 'closed';
  end if;

  if p_accept then
    update public.challenges c
       set status = 'active', play_by = clock_timestamp() + interval '24 hours'
     where c.id = v_c.id;
  else
    update public.challenges c
       set status = 'declined', finished_at = clock_timestamp()
     where c.id = v_c.id;
  end if;
  perform public.challenge_signal(v_c.id);
  return case when p_accept then 'accepted' else 'declined' end;
end;
$$;

revoke all on function public.respond_to_challenge(uuid, boolean) from public, anon, authenticated;
grant execute on function public.respond_to_challenge(uuid, boolean) to authenticated;

-- The challenger can take it back until the friend has answered.
create or replace function public.cancel_challenge(p_challenge uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
  v_c  public.challenges;
begin
  if v_me is null then
    raise exception 'a challenge needs a signed-in account' using errcode = '42501';
  end if;

  select * into v_c from public.challenges c
   where c.id = p_challenge and c.challenger_id = v_me
   for update;
  if not found or v_c.status not in ('draft', 'pending') then
    return 'closed';
  end if;

  update public.challenges c
     set status = 'cancelled', finished_at = clock_timestamp()
   where c.id = v_c.id;
  perform public.challenge_signal(v_c.id);
  return 'cancelled';
end;
$$;

revoke all on function public.cancel_challenge(uuid) from public, anon, authenticated;
grant execute on function public.cancel_challenge(uuid) to authenticated;

-- Playing -----------------------------------------------------------------------

-- The one attempt. Issues a session on the shared seed, and is the only thing that
-- hands that seed out. The seed is text because JSON numbers lose a bigint's low bits.
--   started           here is the session
--   already_played    this player's attempt has been used
--   not_your_turn     it isn't open to this player right now
--   update_required   the other player's run is on rules this client doesn't have
--   not_playable      the game was withdrawn, or these rules have no verifier
create or replace function public.start_challenge_run(
  p_challenge     uuid,
  p_rules_version text,
  p_client        text
)
returns table (
  outcome       text,
  session_id    uuid,
  game_slug     text,
  rules_version text,
  seed          text,
  tile_count    integer,
  started_at    timestamptz,
  expires_at    timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me      uuid := auth.uid();
  v_c       public.challenges;
  v_game    public.games;
  v_runtime public.game_runtimes;
  v_session public.game_sessions;
  v_client  text := left(nullif(btrim(coalesce(p_client, '')), ''), 40);
begin
  if v_me is null then
    raise exception 'a challenge needs a signed-in account' using errcode = '42501';
  end if;

  select * into v_c from public.challenges c
   where c.id = p_challenge and v_me in (c.challenger_id, c.opponent_id)
   for update;
  if not found then
    return query select 'not_your_turn'::text, null::uuid, null::text, null::text, null::text,
      null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  if (v_me = v_c.challenger_id and v_c.challenger_session is not null)
     or (v_me = v_c.opponent_id and v_c.opponent_session is not null) then
    return query select 'already_played'::text, null::uuid, null::text, null::text, null::text,
      null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- A beat-my-score is its challenger's alone until they have played, and only the
  -- challenger has anything to prove on a score target.
  if not (
    (v_c.status = 'draft' and v_me = v_c.challenger_id)
    or (v_c.status = 'active'
        and (v_c.play_by is null or v_c.play_by > clock_timestamp())
        and (v_c.format <> 'score_target' or v_me = v_c.challenger_id))
  ) then
    return query select 'not_your_turn'::text, null::uuid, null::text, null::text, null::text,
      null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v_game from public.games g
   where g.id = v_c.game_id and g.status = 'published' and g.playable and g.runtime is not null;
  if not found then
    return query select 'not_playable'::text, null::uuid, null::text, null::text, null::text,
      null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  -- The first run pins the rules: the same seed under other rules is a different board.
  if v_c.rules_version is not null and v_c.rules_version <> p_rules_version then
    return query select 'update_required'::text, null::uuid, null::text, null::text, null::text,
      null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  select * into v_runtime from public.game_runtimes r
   where r.runtime = v_game.runtime and r.rules_version = p_rules_version;
  if not found then
    return query select 'not_playable'::text, null::uuid, null::text, null::text, null::text,
      null::integer, null::timestamptz, null::timestamptz;
    return;
  end if;

  insert into public.game_sessions (game_id, user_id, client, rules_version, seed, expires_at, challenge_id)
  values (v_c.game_id, v_me, v_client, p_rules_version, v_c.seed,
          now() + make_interval(hours => v_runtime.session_hours), v_c.id)
  returning * into v_session;

  update public.challenges c
     set rules_version = p_rules_version,
         challenger_session = case when v_me = c.challenger_id then v_session.id else c.challenger_session end,
         opponent_session = case when v_me = c.opponent_id then v_session.id else c.opponent_session end
   where c.id = v_c.id;

  perform public.challenge_signal(v_c.id);

  return query select 'started'::text, v_session.id, v_game.slug::text, v_session.rules_version,
    v_session.seed::text, v_runtime.max_actions, v_session.started_at, v_session.expires_at;
end;
$$;

revoke all on function public.start_challenge_run(uuid, text, text) from public, anon, authenticated;
grant execute on function public.start_challenge_run(uuid, text, text) to authenticated;

-- Reading -----------------------------------------------------------------------

-- A chat's challenges, from the caller's side. Sealed means sealed: the other player's
-- score isn't in the answer until it is finished, unless it is the score to beat. A
-- draft belongs to its challenger alone and isn't listed. Settles what has run out of
-- time first, so reading always shows the truth.
create or replace function public.conversation_challenges(p_conversation uuid)
returns table (
  id           uuid,
  challenger_id uuid,
  opponent_id  uuid,
  game_slug    text,
  game_title   text,
  format       text,
  status       text,
  stake        text,
  margin       bigint,
  target_score bigint,
  is_double    boolean,
  rematch_of   uuid,
  respond_by   timestamptz,
  play_by      timestamptz,
  finished_at  timestamptz,
  winner_id    uuid,
  my_score     bigint,
  their_score  bigint,
  i_started    boolean,
  they_finished boolean,
  rematch_taken boolean
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'reading a chat needs a signed-in account' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.conversation_participants p
     where p.conversation_id = p_conversation and p.user_id = v_me
  ) then
    return;
  end if;

  perform public.challenge_sweep(v_me);

  return query
  select
    c.id, c.challenger_id, c.opponent_id, g.slug::text, g.title, c.format, c.status, c.stake,
    c.margin, c.target_score, c.is_double, c.rematch_of, c.respond_by, c.play_by, c.finished_at, c.winner_id,
    case when v_me = c.challenger_id then c.challenger_score else c.opponent_score end,
    case
      when c.status = 'finished' then
        case when v_me = c.challenger_id then c.opponent_score else c.challenger_score end
      when c.format = 'beat_my_score' and v_me = c.opponent_id then c.challenger_score
    end,
    case when v_me = c.challenger_id then c.challenger_session else c.opponent_session end is not null,
    case when v_me = c.challenger_id then c.opponent_score else c.challenger_score end is not null,
    exists (select 1 from public.challenges r where r.rematch_of = c.id)
  from public.challenges c
  join public.games g on g.id = c.game_id
  where c.conversation_id = p_conversation
    and c.status <> 'draft'
  order by c.created_at desc
  limit 100;
end;
$$;

revoke all on function public.conversation_challenges(uuid) from public, anon, authenticated;
grant execute on function public.conversation_challenges(uuid) to authenticated;

-- The scoreline at the top of a chat. A double or nothing the original loser won wipes
-- the loss and adds nothing; one they lost counts as a second loss.
create or replace function public.rivalry_record(p_other uuid)
returns table (my_wins integer, their_wins integer, draws integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'reading a chat needs a signed-in account' using errcode = '42501';
  end if;

  return query
  with results as (
    select c.winner_id,
           case
             -- Won their double: the loss is wiped, and this win is only that.
             when c.is_double and c.winner_id is not null and parent.winner_id is not null
                  and c.winner_id <> parent.winner_id then 0
             -- Lost a double, later wiped: not applicable, a double can't be doubled.
             when exists (
               select 1 from public.challenges r
                where r.rematch_of = c.id and r.is_double
                  and r.status = 'finished'
                  and r.winner_id is not null
                  and r.winner_id <> c.winner_id
             ) then 0
             else 1
           end as weight
      from public.challenges c
      left join public.challenges parent on parent.id = c.rematch_of
     where c.user_low = least(v_me, p_other)
       and c.user_high = greatest(v_me, p_other)
       and c.status = 'finished'
  )
  select
    coalesce(sum(weight) filter (where winner_id = v_me), 0)::integer,
    coalesce(sum(weight) filter (where winner_id = p_other), 0)::integer,
    (count(*) filter (where winner_id is null))::integer
  from results;
end;
$$;

revoke all on function public.rivalry_record(uuid) from public, anon, authenticated;
grant execute on function public.rivalry_record(uuid) to authenticated;

-- The price of losing: a line on the loser's profile for a day, two after losing a
-- double or nothing. The wording is the app's, from these facts, so nothing a player
-- typed can end up on someone's profile. A private profile keeps it off, and so does a
-- block, in the same way a private profile hides the rest.
create or replace function public.challenge_badge(p_user uuid)
returns table (winner_username text, game_title text, until timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select w.username::text, g.title,
         c.finished_at + case when c.is_double then interval '48 hours' else interval '24 hours' end
    from public.challenges c
    join public.profiles w on w.id = c.winner_id
    join public.games g on g.id = c.game_id
   where c.status = 'finished'
     and p_user in (c.challenger_id, c.opponent_id)
     and c.winner_id is not null
     and c.winner_id <> p_user
     and c.finished_at
         + case when c.is_double then interval '48 hours' else interval '24 hours' end > now()
     -- Won the double or nothing: this loss is wiped.
     and not exists (
       select 1 from public.challenges r
        where r.rematch_of = c.id and r.is_double
          and r.status = 'finished'
          and r.winner_id = p_user
     )
     and (
       (select auth.uid()) = p_user
       or not exists (
         select 1 from public.user_preferences up
          where up.user_id = p_user and up.private_account
       )
     )
     and not exists (
       select 1 from public.blocked_users b
        where b.blocker_id = p_user and b.blocked_id = (select auth.uid())
     )
     and not w.is_suspended
   order by c.finished_at desc
   limit 1;
$$;

revoke all on function public.challenge_badge(uuid) from public;
grant execute on function public.challenge_badge(uuid) to anon, authenticated;

-- A card isn't a message anyone can unsend: it is the record of a challenge.
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
   where m.id = p_message and m.sender_id = v_me and m.challenge_id is null
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
