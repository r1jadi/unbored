-- Claim a guest run: "sign up and save this score".
--
-- Until now a guest run was verified, closed and left with no owner, and nothing
-- could ever attach it to an account (docs/decisions/0012-server-verified-scores.md).
-- That cost a new player the one score they most wanted to keep: the one that made
-- them sign up. This migration adds a single, narrow way to adopt that run.
--
-- What makes it safe:
--
--   1. The score is still the database's. A claim never carries a number: it names
--      a session the verifier already closed, and the score row is built from the
--      session's own `verified_score`. Claiming moves ownership, never a value.
--
--   2. The session id is the proof, exactly as it already is for completing a guest
--      run. `complete_*_run` accepts any anonymous caller that holds the id of an
--      anonymous session, because only the device that started the run was ever
--      told it: ids are 122 random bits, issued in the start response, and appear in
--      no public read, board or link. A claim asks for nothing more than completion
--      did, and adopts a run only once.
--
--   3. It is narrow. Only a run that was played anonymously, finished and verified,
--      never abandoned, not a challenge run, and finished within the last 24 hours
--      can be claimed — once, by the first signed-in caller. A daily game keeps its
--      one ranked attempt a day: a run on a board the player has already finished
--      is refused, under the same per-player lock the start gate takes.
--
--   4. Everything downstream sees an ordinary ranked run. The session gets its
--      owner and the score row is inserted the way every verifier inserts one, so
--      the triggers on `scores` (beaten-score notifications, challenge skipping)
--      and every board, streak and profile read treat it like any other.

do $$
begin
  create type public.claim_result as (
    -- `claimed`, `duplicate` (this caller already claimed it), `not_found`,
    -- `expired`, `already_played` or `unauthenticated`.
    outcome       text,
    session_id    uuid,
    game_slug     text,
    score         bigint,
    personal_best bigint,
    board_rank    bigint
  );
exception when duplicate_object then null;
end $$;

comment on type public.claim_result is
  'The answer to claiming a guest run. `outcome` is claimed, duplicate, not_found, expired, already_played or unauthenticated.';

-- How long a finished guest run stays claimable: long enough to sign up, confirm an
-- email and come back, short enough that an old id is not a standing credential.
create or replace function public.guest_claim_window()
returns interval language sql immutable set search_path = '' as $$ select interval '24 hours' $$;

create or replace function public.claim_guest_run(p_session_id uuid)
returns public.claim_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result   public.claim_result;
  v_user     uuid := auth.uid();
  v_session  public.game_sessions;
  v_slug     text;
  v_duration integer;
  v_best     bigint;
  v_rank     bigint;
begin
  if v_user is null then
    v_result.outcome := 'unauthenticated';
    return v_result;
  end if;
  if p_session_id is null then
    v_result.outcome := 'not_found';
    return v_result;
  end if;

  -- Locked, so two tabs (or two accounts) claiming at once cannot both win.
  select * into v_session
    from public.game_sessions s
   where s.id = p_session_id
   for update;

  if not found then
    v_result.outcome := 'not_found';
    return v_result;
  end if;

  select g.slug into v_slug from public.games g where g.id = v_session.game_id;

  -- A retry by the account that already claimed it is the same claim.
  if v_session.user_id = v_user and exists (
    select 1 from public.scores sc where sc.session_id = v_session.id
  ) then
    v_result.outcome    := 'duplicate';
    v_result.session_id := v_session.id;
    v_result.game_slug  := v_slug;
    v_result.score      := v_session.verified_score;
  -- Owned by somebody, unfinished, unverified, thrown away or a challenge's: all
  -- answer the same way, so a stranger learns nothing about a run id.
  elsif v_session.user_id is not null
     or v_session.completed_at is null
     or v_session.verified_score is null
     or v_session.abandoned_at is not null
     or v_session.challenge_id is not null then
    v_result.outcome := 'not_found';
    return v_result;
  elsif v_session.completed_at < now() - public.guest_claim_window() then
    v_result.outcome    := 'expired';
    v_result.session_id := v_session.id;
    v_result.game_slug  := v_slug;
    return v_result;
  else
    -- The start gate's lock: the same key, so a claim and a start (or two claims)
    -- for one player and game queue rather than race.
    perform pg_advisory_xact_lock(
      hashtextextended(v_session.game_id::text || ':' || v_user::text, 0)
    );

    -- One ranked run per board. A daily game's seed is the player's day, so this is
    -- its one-attempt rule; any other game's seed is random, so it never matches.
    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_session.game_id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = v_session.seed
    ) then
      v_result.outcome    := 'already_played';
      v_result.session_id := v_session.id;
      v_result.game_slug  := v_slug;
      return v_result;
    end if;

    update public.game_sessions s
       set user_id = v_user
     where s.id = v_session.id;

    -- The run's own length: the verifier timed it from the session, and the guest's
    -- submitted duration was never stored.
    v_duration := greatest(1, least(86400000,
      (extract(epoch from (v_session.completed_at - v_session.started_at)) * 1000)::integer));

    -- Dated when it was played, so a day's board and a streak count the right day.
    insert into public.scores (session_id, game_id, user_id, score, duration_ms, created_at)
    values (v_session.id, v_session.game_id, v_user, v_session.verified_score, v_duration,
            v_session.completed_at);

    v_result.outcome    := 'claimed';
    v_result.session_id := v_session.id;
    v_result.game_slug  := v_slug;
    v_result.score      := v_session.verified_score;
  end if;

  select max(s.score) into v_best from public.scores s
   where s.game_id = v_session.game_id and s.user_id = v_user;
  select count(*) + 1 into v_rank from (
    select s.user_id, max(s.score) as best
      from public.scores s
     where s.game_id = v_session.game_id
     group by s.user_id
  ) t where t.best > coalesce(v_best, 0) and t.user_id <> v_user;
  v_result.personal_best := v_best;
  v_result.board_rank    := v_rank;
  return v_result;
end;
$$;

comment on function public.claim_guest_run(uuid) is
  'Adopts a finished, verified guest run for the signed-in caller and records its verified score. Once per run, within public.guest_claim_window(); a daily board already finished answers already_played.';

revoke all on function public.claim_guest_run(uuid) from public, anon;
grant execute on function public.claim_guest_run(uuid) to authenticated;
