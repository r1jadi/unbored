-- Alibi (`alibi@1`): a small mystery a day, verified by the database.
--
-- Three suspects, four to six files of evidence, and one statement a file
-- contradicts. The player opens files and accuses one suspect with one file as the
-- proof; two accusations at most.
--
--   1. The rules version, the bound on a submission, and the bank: each case's
--      file count, the suspect who is lying and the file that proves it, written
--      by `bun scripts/generate-daily-banks.ts --write` from
--      `src/lib/games/alibi-bank.ts` and `alibi-answers.ts`. The case text stays in
--      the client.
--   2. `alibi_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_alibi_run`, the verifier: the generic gate, one completion a day
--      (`already_played`), the replay, and `speed_run_finish`.
--   4. The registry row. The day seed is `20270122120100_alibi_start.sql`.
--
-- Nothing a user can see changes: `20270122120200_alibi_playable.sql` flips the
-- catalogue and lands last. Mirrored by src/lib/games/alibi.ts. See
-- docs/games/README.md.

create or replace function public.alibi_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'alibi@1'::text $$;

create or replace function public.alibi_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8 $$;

comment on function public.alibi_rules_version() is
  'The Alibi rules version: alibi@1.';
comment on function public.alibi_max_actions() is
  'The most moves one Alibi submission may carry: six files and two accusations, 8.';

create or replace function public.alibi_case_count()
returns integer language sql immutable set search_path = '' as $$
  select
    -- alibi-count:begin
    10
    -- alibi-count:end
$$;

create or replace function public.alibi_case_for(p_day bigint)
returns integer language sql immutable set search_path = '' as $$
  select (((p_day % public.alibi_case_count()) + public.alibi_case_count())
          % public.alibi_case_count())::integer
$$;

-- A case: its file count, the suspect who is lying (0 to 2) and the file that
-- proves it, by their places in the client's bank.
create or replace function public.alibi_case(p_case integer)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_case
    -- alibi-bank:begin
    when 0 then array[5, 2, 1] -- tip-jar
    when 1 then array[6, 2, 0] -- wedding-cake
    when 2 then array[6, 2, 0] -- prize-marrow
    when 3 then array[5, 0, 1] -- cut-roses
    when 4 then array[5, 1, 3] -- deleted-pitch
    when 5 then array[5, 1, 4] -- tuck-shop
    when 6 then array[4, 0, 2] -- broken-window
    when 7 then array[5, 2, 3] -- silent-dog
    when 8 then array[5, 0, 2] -- missing-mascot
    when 9 then array[5, 2, 4] -- winning-ticket
    -- alibi-bank:end
  end
$$;

comment on function public.alibi_case(integer) is
  'alibi@1''s cases: the file count, the lying suspect and the proving file. Mirrored by src/lib/games/alibi-bank.ts and alibi-answers.ts.';

-- The score a day's moves make, or null when they are not a legal run.
--
-- A move opens file c (the code c, 0 to 5) or accuses suspect s with file c
-- (6 + s * 6 + c, 6 to 23). A file opens once; an accusation needs its file open
-- and cannot repeat; nothing follows a solve or the second wrong accusation.
-- A solve scores 100 - 8 per file opened - 30 per wrong accusation; anything else 0.
create or replace function public.alibi_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_case    integer[] := public.alibi_case(public.alibi_case_for(p_day));
  v_cards   integer := v_case[1];
  v_culprit integer := v_case[2];
  v_proof   integer := v_case[3];
  v_opened  integer := 0;
  v_open    integer := 0;
  v_tried   integer := 0;
  v_misses  integer := 0;
  v_solved  boolean := false;
  v_action  integer;
  v_suspect integer;
  v_card    integer;
begin
  if coalesce(cardinality(p_actions), 0) > 8 then
    return null;
  end if;

  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_action is null or v_action < 0 or v_action > 23 then
      return null;
    end if;
    if v_solved or v_misses >= 2 then
      return null;
    end if;

    if v_action < 6 then
      if v_action >= v_cards or (v_open & (1 << v_action)) <> 0 then
        return null;
      end if;
      v_open := v_open | (1 << v_action);
      v_opened := v_opened + 1;
    else
      v_suspect := (v_action - 6) / 6;
      v_card := (v_action - 6) % 6;
      if v_card >= v_cards
         or (v_open & (1 << v_card)) = 0
         or (v_tried & (1 << (v_action - 6))) <> 0 then
        return null;
      end if;
      v_tried := v_tried | (1 << (v_action - 6));
      if v_suspect = v_culprit and v_card = v_proof then
        v_solved := true;
      else
        v_misses := v_misses + 1;
      end if;
    end if;
  end loop;

  return case when v_solved then 100 - 8 * v_opened - 30 * v_misses else 0 end;
end;
$$;

comment on function public.alibi_score(bigint, integer[]) is
  'An Alibi day''s moves replayed: 100 for a solve, less 8 a file opened and 30 a wrong accusation, else 0; null when the moves are not a legal run.';

revoke all on function public.alibi_case(integer) from public;
revoke all on function public.alibi_score(bigint, integer[]) from public;

create or replace function public.complete_alibi_run(
  p_session_id  uuid,
  p_actions     integer[],
  p_score       bigint,
  p_duration_ms integer
)
returns public.play_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate   record;
  v_result public.play_result;
  v_score  bigint;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms,
    public.alibi_rules_version(), public.alibi_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  -- One ranked play a day: the day is the seed.
  if (v_gate.session).user_id is not null and exists (
    select 1
      from public.game_sessions s
     where s.game_id = (v_gate.session).game_id
       and s.user_id = (v_gate.session).user_id
       and s.seed = (v_gate.session).seed
       and s.id <> (v_gate.session).id
       and s.completed_at is not null
  ) then
    v_result.outcome := 'already_played';
    return v_result;
  end if;

  v_score := public.alibi_score((v_gate.session).seed, p_actions);
  if v_score is null then
    v_result.outcome := 'invalid_actions';
    return v_result;
  end if;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    0, v_gate.elapsed, coalesce(cardinality(p_actions), 0),
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_alibi_run(uuid, integer[], bigint, integer) is
  'Alibi: replays a day''s files and accusations on the day''s case and records the score.';

revoke all on function public.complete_alibi_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_alibi_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('alibi', public.alibi_rules_version(), public.alibi_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
