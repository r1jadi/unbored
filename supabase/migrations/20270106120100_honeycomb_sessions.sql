-- Honeycomb (`honeycomb@1`): seven letters and every word they make, verified by
-- the database.
--
-- Words of four or more letters from the day's seven, always holding the centre one.
-- A four-letter word is worth 1, a longer one its length, and a word using all seven
-- letters 7 more. The words live in the client (`src/lib/games/honeycomb-bank.ts`,
-- generated from a word list); the database needs only each word's points, in the
-- same order, because a move names a word by its place in the day's list.
--
--   1. The rules version, the bound on a submission, and the bank: each puzzle's word
--      points, written by `bun scripts/generate-daily-banks.ts --write`.
--   2. `honeycomb_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_honeycomb_run`, the verifier: the generic gate, one completion a day
--      (`already_played`), the replay, and `speed_run_finish` with no par.
--   4. The registry row, with the longer of the two session lengths: a day's hive is
--      played on and off.
--      The day seed is `20270106120200_then_and_now_honeycomb_start.sql`.
--
-- Nothing a user can see changes: `20270106120300_then_and_now_honeycomb_playable.sql`
-- flips the catalogue and lands last. Mirrored by src/lib/games/honeycomb.ts. See
-- docs/games/README.md.

create or replace function public.honeycomb_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'honeycomb@1'::text $$;

-- No puzzle has more than 64 words (`honeycomb.test.ts` checks the bank).
create or replace function public.honeycomb_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 64 $$;

comment on function public.honeycomb_rules_version() is 'The Honeycomb rules version: honeycomb@1.';
comment on function public.honeycomb_max_actions() is
  'The most words one Honeycomb submission may carry: sixty-four.';

create or replace function public.honeycomb_puzzle_count()
returns integer language sql immutable set search_path = '' as $$
  select
    -- honeycomb-count:begin
    60
    -- honeycomb-count:end
$$;

create or replace function public.honeycomb_puzzle_for(p_day bigint)
returns integer language sql immutable set search_path = '' as $$
  select (((p_day % public.honeycomb_puzzle_count()) + public.honeycomb_puzzle_count())
          % public.honeycomb_puzzle_count())::integer
$$;

-- A puzzle's word points: word i (from 0, the sorted list) is worth element i + 1.
create or replace function public.honeycomb_points(p_puzzle integer)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_puzzle
    -- honeycomb-points:begin
    when 0 then array[6, 7, 5, 1, 7, 1, 6, 6, 1, 7, 5, 1, 1, 1, 1, 6, 1, 5, 6, 1, 6, 1, 1, 6, 1, 1, 6, 5, 7, 5, 6, 17, 1, 7, 1, 6, 7, 5, 7, 8, 6, 1, 6, 6, 1, 1, 6, 6, 1, 6, 5, 7, 8, 5, 1, 5, 1, 1, 1]
    when 1 then array[7, 5, 6, 1, 1, 5, 6, 8, 1, 9, 14, 1, 1, 5, 1, 6, 5, 5, 1, 1, 1, 5, 1, 1, 1, 1, 6, 9, 7, 1, 1, 1, 1]
    when 2 then array[6, 1, 7, 1, 5, 6, 8, 6, 10, 1, 9, 18, 9, 6, 10, 1, 7, 5, 5, 1, 5, 6, 5, 9, 6, 6, 5, 9, 7]
    when 3 then array[1, 5, 6, 5, 1, 5, 5, 1, 1, 5, 6, 1, 5, 6, 15, 1, 1, 1, 1, 1]
    when 4 then array[1, 5, 5, 5, 14, 5, 7, 5, 6, 5, 5, 1, 5, 6, 1, 6, 1, 7, 6, 1, 6, 1, 1]
    when 5 then array[7, 1, 7, 5, 1, 1, 5, 5, 15, 5, 1, 1, 5, 5, 5, 5, 5, 1, 5, 6, 1, 6, 5, 5, 5, 5, 1, 1, 1]
    when 6 then array[1, 5, 5, 6, 1, 5, 7, 1, 1, 1, 5, 5, 7, 1, 7, 16, 1, 5, 1, 7, 1, 5, 1, 5, 5, 5, 1]
    when 7 then array[6, 5, 6, 5, 1, 6, 14, 5, 5, 6, 5, 6, 1, 5, 5, 7, 1, 6, 5, 1]
    when 8 then array[7, 5, 1, 1, 1, 1, 1, 5, 1, 1, 7, 8, 1, 1, 5, 6, 7, 5, 5, 7, 16, 5, 6, 7, 9, 1]
    when 9 then array[7, 7, 1, 6, 5, 1, 6, 5, 1, 1, 1, 1, 5, 5, 7, 16, 5, 1, 1, 1, 1, 5, 6, 1, 1, 5]
    when 10 then array[1, 5, 1, 5, 5, 1, 6, 6, 6, 7, 5, 1, 6, 1, 5, 7, 6, 6, 6, 8, 5, 1, 5, 5, 5, 1, 5, 14, 6, 1, 5, 6, 7, 5, 1, 5, 1, 6, 5, 7, 1, 5, 1, 6, 6, 6, 5, 6, 1, 6, 6, 5, 1, 7, 5, 7, 1, 5, 6, 1]
    when 11 then array[6, 7, 6, 5, 5, 8, 6, 7, 8, 7, 6, 6, 6, 6, 5, 5, 16, 5, 9, 5]
    when 12 then array[6, 5, 5, 7, 9, 5, 6, 7, 5, 6, 1, 5, 5, 6, 6, 7, 6, 1, 6, 7, 5, 1, 1, 9, 14, 1, 6, 7, 5, 6, 1, 1, 6, 1, 1, 5, 5, 15, 8, 6, 5, 5, 6]
    when 13 then array[5, 8, 6, 7, 6, 7, 1, 5, 5, 6, 1, 1, 1, 1, 5, 1, 5, 7, 8, 5, 1, 6, 6, 7, 6, 8, 6, 6, 1, 1, 6, 5, 1, 6, 5, 6, 1, 1, 1, 5, 8, 16, 1, 5, 1, 6, 5]
    when 14 then array[1, 5, 7, 1, 8, 5, 1, 5, 6, 1, 1, 6, 9, 7, 6, 6, 1, 5, 5, 6, 1, 1, 6, 16, 1, 1, 1, 6, 7, 1, 5, 1, 6, 5, 1, 5, 6, 6, 5]
    when 15 then array[6, 6, 1, 7, 6, 1, 5, 6, 5, 5, 1, 1, 1, 1, 8, 5, 6, 1, 6, 6, 6, 1, 5, 1, 1, 7, 5, 1, 1, 5, 16, 6, 1, 5, 5, 1, 6, 9, 7]
    when 16 then array[5, 5, 6, 1, 6, 5, 7, 1, 7, 8, 5, 9, 5, 5, 1, 1, 7, 7, 8, 5, 5, 5, 16, 1, 1, 7, 6, 1, 8, 1, 6, 5, 1, 5, 5, 1, 1, 6, 8, 1, 1]
    when 17 then array[6, 1, 8, 1, 7, 1, 8, 5, 5, 15, 1, 5, 5, 1, 6, 1, 1, 8, 6, 5, 5, 8, 6, 5, 1, 1, 5, 1]
    when 18 then array[1, 5, 5, 14, 1, 1, 1, 6, 1, 1, 1, 1, 5, 5, 5, 1, 8, 1, 5, 1, 1, 7, 7, 6]
    when 19 then array[5, 1, 6, 5, 5, 6, 1, 5, 5, 5, 5, 1, 1, 6, 1, 1, 1, 1, 5, 1, 1, 1, 5, 1, 1, 9, 1, 1, 6, 1, 6, 5, 1, 1, 5, 1, 1, 5, 1, 6, 6, 1, 1, 17, 1]
    when 20 then array[5, 6, 8, 1, 5, 1, 1, 1, 1, 1, 1, 5, 15, 5, 1, 1, 1, 1, 1, 1, 1, 5, 6, 1, 1, 5]
    when 21 then array[1, 6, 16, 8, 9, 6, 8, 6, 8, 6, 5, 7, 18, 1, 5, 5, 1, 6, 1, 1, 5, 1, 1, 5, 6, 5]
    when 22 then array[6, 5, 7, 1, 5, 1, 1, 5, 1, 1, 6, 7, 1, 7, 1, 1, 1, 5, 1, 1, 5, 1, 16, 6, 1, 6]
    when 23 then array[1, 5, 6, 1, 5, 14, 5, 6, 1, 1, 6, 6, 6, 1, 6, 1, 1, 7, 1, 5, 5, 1, 1, 8, 5, 5, 1, 6, 1, 1]
    when 24 then array[5, 1, 5, 1, 5, 5, 1, 5, 1, 1, 6, 1, 1, 1, 5, 1, 1, 1, 1, 14, 1]
    when 25 then array[1, 1, 1, 5, 1, 6, 7, 1, 1, 8, 15, 5, 6, 8, 1, 6, 1, 5, 1, 1, 5, 5, 6, 5, 1, 1, 5, 6, 1, 6, 1, 1, 1]
    when 26 then array[1, 8, 1, 6, 5, 5, 7, 1, 7, 1, 1, 1, 5, 5, 5, 1, 1, 1, 1, 1, 6, 1, 1, 5, 6, 1, 1, 5, 1, 1, 8, 1, 1, 5, 8, 7, 6, 15, 6, 1, 1, 1, 6, 1, 6, 10, 1, 1, 1, 8, 1, 7, 8, 9, 8, 15, 9, 7, 6]
    when 27 then array[6, 7, 1, 5, 1, 1, 6, 1, 5, 1, 6, 1, 6, 1, 5, 1, 6, 1, 6, 6, 6, 1, 6, 1, 7, 5, 14, 1, 5, 5]
    when 28 then array[1, 5, 1, 5, 7, 5, 7, 1, 1, 6, 1, 1, 5, 1, 5, 1, 5, 6, 5, 1, 6, 1, 6, 1, 6, 6, 6, 5, 1, 1, 1, 7, 9, 1, 1, 6, 6, 5, 5, 6, 5, 6, 14, 1]
    when 29 then array[5, 7, 7, 7, 5, 6, 5, 6, 1, 1, 1, 1, 1, 6, 1, 1, 7, 6, 1, 1, 5, 1, 1, 5, 1, 6, 1, 6, 1, 6, 7, 1, 8, 1, 6, 1, 1, 1, 1, 1, 6, 1, 5, 6, 5, 1, 5, 5, 14, 1, 6, 6, 1, 1, 1, 1, 1, 1]
    when 30 then array[1, 1, 6, 1, 6, 1, 5, 6, 7, 8, 5, 8, 1, 7, 7, 1, 5, 1, 5, 1, 6, 6, 1, 6, 6, 1, 7, 6, 5, 7, 6, 8, 8, 8, 5, 8, 6, 6, 8, 8, 1, 6, 1, 5, 1, 6, 1, 6, 8, 7, 6, 8, 15, 1, 7, 5, 5, 5, 7]
    when 31 then array[5, 6, 6, 6, 1, 1, 5, 14, 5, 1, 8, 1, 1, 5, 5, 1, 5, 1, 1, 6, 1, 1, 6, 6, 5, 1, 1, 7, 5, 6, 7, 7, 6, 8, 6, 1, 6, 1, 6, 7]
    when 32 then array[5, 5, 5, 5, 1, 1, 1, 1, 1, 6, 6, 1, 1, 5, 1, 6, 1, 7, 1, 6, 1, 5, 7, 1, 15]
    when 33 then array[8, 1, 6, 1, 1, 7, 1, 7, 10, 6, 1, 7, 1, 7, 6, 7, 1, 7, 1, 14, 1, 7, 5, 1, 7, 8, 1, 7, 1, 6, 1, 7, 1, 8, 6, 1, 14, 5, 15, 8, 1, 7, 1, 7, 5, 6, 10]
    when 34 then array[6, 16, 1, 7, 1, 6, 6, 7, 1, 8, 7, 6, 10, 8, 7, 1, 7, 6, 8, 8, 6, 10, 8, 6, 1, 1, 7, 1, 6, 7, 1, 7, 1, 1, 6, 7, 8, 1, 6, 1, 7, 1, 8, 5, 1, 7, 6, 1, 6, 1, 1, 5, 8, 7, 7, 1, 7, 7]
    when 35 then array[7, 1, 6, 1, 6, 5, 1, 5, 1, 1, 5, 6, 6, 5, 1, 1, 1, 5, 1, 1, 5, 15, 6, 1, 5, 5, 1, 1, 5, 1, 1, 1, 5, 6, 6, 5, 6, 1, 1, 5, 1, 5]
    when 36 then array[1, 5, 1, 5, 1, 1, 1, 1, 5, 1, 1, 6, 17, 5, 1, 5, 8, 1, 1, 1, 5, 15, 1, 1, 5, 1, 8, 5, 1, 1, 1, 1, 1, 1, 6, 1, 1]
    when 37 then array[7, 1, 5, 19, 1, 1, 1, 1, 5, 1, 5, 1, 1, 5, 6, 9, 17, 5, 5, 6, 16]
    when 38 then array[1, 1, 7, 1, 1, 1, 5, 16, 1, 1, 1, 1, 5, 5, 1, 5, 1, 1, 1, 1, 1, 1, 5, 1, 6, 1]
    when 39 then array[6, 5, 8, 1, 5, 8, 6, 5, 8, 1, 5, 7, 6, 8, 9, 1, 7, 5, 1, 7, 1, 7, 1, 7, 15]
    when 40 then array[1, 1, 5, 1, 1, 7, 1, 8, 5, 1, 5, 6, 5, 6, 1, 5, 1, 6, 9, 7, 6, 6, 1, 6, 6, 1, 5, 6, 5, 1, 14, 15, 6, 1, 6, 6, 6, 7, 5, 8, 6, 6, 1, 5, 6, 5, 5]
    when 41 then array[5, 5, 1, 1, 6, 1, 5, 1, 1, 5, 14, 5, 1, 1, 5, 5, 5, 1, 1, 6, 1, 6, 5, 1, 1, 1, 6, 1, 1]
    when 42 then array[6, 1, 7, 7, 1, 6, 1, 6, 16, 8, 7, 5, 6, 1, 6, 7, 5, 5, 5, 1, 8, 5, 7, 5, 5, 5, 1, 5, 6, 7, 8, 1, 5, 15, 1, 6]
    when 43 then array[1, 6, 1, 6, 1, 1, 5, 5, 5, 1, 7, 15, 6, 1, 5, 5, 1, 1, 1, 5, 1, 6, 1, 1, 1, 1, 1, 1, 1, 6, 1]
    when 44 then array[1, 6, 15, 5, 1, 5, 6, 6, 1, 5, 1, 7, 1, 1, 1, 1, 6, 5, 7, 5, 1, 1, 5, 1, 6, 7, 6, 5, 5, 7, 5, 5]
    when 45 then array[1, 1, 1, 5, 5, 5, 6, 15, 7, 1, 1, 1, 1, 1, 6, 6, 6, 1, 5, 1, 1, 1, 1, 5, 1, 1, 1]
    when 46 then array[5, 1, 5, 6, 5, 6, 6, 5, 5, 1, 5, 5, 5, 6, 1, 1, 1, 16, 6, 1, 1, 7, 5, 1, 5, 5, 1, 1, 1, 1, 1, 5, 7, 8, 1, 1, 1, 1, 7, 5, 1]
    when 47 then array[7, 5, 5, 1, 1, 7, 6, 1, 1, 5, 1, 1, 1, 15, 6, 5, 1, 1, 1, 6, 1, 5, 7, 1, 1]
    when 48 then array[6, 8, 6, 8, 10, 5, 5, 7, 16, 1, 6, 6, 1, 5, 1, 6, 1, 6, 5, 1, 6, 6]
    when 49 then array[5, 6, 1, 7, 6, 7, 1, 5, 6, 7, 1, 7, 7, 14, 5, 7, 1, 7, 7, 6, 6, 7, 1, 1, 1, 1, 5, 6, 6, 7, 1, 6, 1, 6, 1, 5, 5, 6, 1, 5, 6, 6, 5, 5]
    when 50 then array[6, 10, 7, 10, 1, 7, 7, 1, 7, 5, 1, 8, 8, 1, 1, 7, 8, 5, 9, 6, 1, 1, 5, 6, 1, 6, 6, 5, 5, 1, 7, 7, 5, 6, 8, 1, 5, 8, 11, 7, 18, 5, 5, 1, 7, 6, 5, 5, 6, 1, 1, 6, 5, 1, 1, 6, 6, 1, 7]
    when 51 then array[7, 1, 5, 1, 1, 1, 1, 5, 8, 7, 5, 5, 15, 6, 1, 6, 5, 1, 6, 1, 5, 1, 5, 1, 1, 5, 5, 1, 6]
    when 52 then array[6, 8, 1, 8, 5, 18, 5, 1, 6, 5, 7, 1, 6, 1, 7, 1, 6, 1, 1, 5, 5, 1, 1, 5, 1, 5, 5]
    when 53 then array[1, 6, 7, 7, 6, 6, 7, 1, 5, 6, 6, 5, 14, 6, 7, 7, 1, 5, 7, 5, 7, 5, 6, 6, 8, 1, 9, 6, 1, 5, 6, 5, 7, 8, 15, 1, 6, 5, 5, 7, 6, 1, 5, 5, 1, 6, 9, 6, 5, 1, 6, 6, 1, 5, 5, 1]
    when 54 then array[5, 1, 7, 9, 5, 10, 6, 1, 1, 1, 6, 5, 8, 1, 9, 10, 10, 10, 10, 10, 1, 1, 1, 8, 1, 5, 6, 5, 5, 1, 5, 6, 7, 1, 1, 5, 9, 17, 6, 10, 8, 1, 7, 7, 5, 6, 6, 5, 6, 1, 7, 9, 1]
    when 55 then array[1, 1, 7, 6, 1, 6, 6, 1, 6, 1, 6, 6, 8, 7, 7, 1, 5, 6, 1, 5, 5, 6, 16, 5, 5, 5, 1, 1, 5, 9]
    when 56 then array[1, 1, 1, 16, 1, 5, 1, 7, 7, 1, 1, 5, 5, 1, 1, 1, 5, 1, 5, 1, 1, 1, 1, 1, 1, 1, 8, 1, 1, 5]
    when 57 then array[1, 5, 14, 5, 5, 7, 5, 6, 5, 5, 5, 5, 1, 1, 6, 5, 5, 5, 5, 1, 6, 8, 1, 1]
    when 58 then array[6, 1, 6, 6, 1, 6, 1, 5, 5, 1, 1, 7, 1, 1, 1, 8, 5, 5, 1, 5, 5, 1, 6, 1, 1, 1, 1, 6, 1, 1, 1, 1, 1, 5, 6, 7, 7, 6, 17, 8]
    when 59 then array[5, 5, 1, 6, 1, 15, 1, 5, 1, 1, 6, 1, 8, 6, 1, 1, 1, 6, 1, 6, 1, 6, 1, 6, 5, 1, 6, 1, 1, 5, 6, 1, 5, 6, 8, 5, 1, 5, 5, 6, 5, 1, 1, 6, 5, 5]
    -- honeycomb-points:end
  end
$$;

comment on function public.honeycomb_points(integer) is
  'honeycomb@1''s word points by puzzle. Mirrored by src/lib/games/honeycomb-bank.ts.';

-- The score a day's words make, or null when they are not a legal run: an id out of
-- range, a word found twice, or a move after every word was found. Stopping early is
-- legal, and is how a day usually ends.
create or replace function public.honeycomb_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_points integer[] := public.honeycomb_points(public.honeycomb_puzzle_for(p_day));
  v_seen   integer[] := '{}';
  v_score  bigint := 0;
  v_action integer;
begin
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_action is null or v_action < 0 or v_action >= cardinality(v_points)
       or v_action = any(v_seen) then
      return null;
    end if;
    v_seen := v_seen || v_action;
    v_score := v_score + v_points[v_action + 1];
  end loop;
  return v_score;
end;
$$;

comment on function public.honeycomb_score(bigint, integer[]) is
  'A Honeycomb day''s words replayed: the sum of their points; null when the words are not a legal run.';

revoke all on function public.honeycomb_points(integer) from public;
revoke all on function public.honeycomb_score(bigint, integer[]) from public;

create or replace function public.complete_honeycomb_run(
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
    public.honeycomb_rules_version(), public.honeycomb_max_actions());
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

  v_score := public.honeycomb_score((v_gate.session).seed, p_actions);
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
    0, v_gate.elapsed, case when coalesce(cardinality(p_actions), 0) = cardinality(public.honeycomb_points(public.honeycomb_puzzle_for((v_gate.session).seed))) then 1 else 0 end,
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_honeycomb_run(uuid, integer[], bigint, integer) is
  'Foursort: replays a day''s guesses and records the score.';

revoke all on function public.complete_honeycomb_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_honeycomb_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('honeycomb', public.honeycomb_rules_version(), public.honeycomb_max_actions(), 12)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
