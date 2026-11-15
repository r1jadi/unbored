-- Pixelock (`pixelock@1`): a daily 10 × 10 picture logic puzzle, verified by the
-- database.
--
-- Every row and column is clued with the runs of filled cells it holds. A move fills
-- a cell or crosses it out; every move is checked against the day's picture, and a
-- wrong one costs one of three lives and shows the cell as it is.
--
--   1. The rules version and the bank: each picture's hundred cells, row by row,
--      `#` filled and `.` blank, in the order of `src/lib/games/pixelock-bank.ts`,
--      written by `bun scripts/generate-daily-banks.ts --write`.
--   2. `pixelock_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_pixelock_run`, the verifier: the generic gate, one completion a day
--      (`already_played`), the replay, and `speed_run_finish` with no par.
--   4. The registry row. The day seed is `20270105120200_foursort_pixelock_start.sql`.
--
-- Nothing a user can see changes: `20270105120300_foursort_pixelock_playable.sql`
-- flips the catalogue and lands last. Mirrored by src/lib/games/pixelock.ts. See
-- docs/games/README.md.

create or replace function public.pixelock_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'pixelock@1'::text $$;

-- Every move shows one of the hundred cells, so a run has a hundred moves at most.
create or replace function public.pixelock_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 100 $$;

comment on function public.pixelock_rules_version() is 'The Pixelock rules version: pixelock@1.';
comment on function public.pixelock_max_actions() is
  'The most moves one Pixelock submission may carry: one for each of the hundred cells.';

create or replace function public.pixelock_pictures()
returns text[] language sql immutable set search_path = '' as $$
  select array[
    -- pixelock-bank:begin
    '.##....##.####..##################################.########...######.....####.......##..............', -- 0: Heart
    '....##.......####.....######...########.##########.#......#..#.##...#..#.##.###..#....###..########.', -- 1: House
    '#........###......#####....##############..####..###############..####.###..###...######.....####...', -- 2: Cat
    '....##.......####.....######.....####.....######...########.##########....##........##......######..', -- 3: Tree
    '..........#######...#.....#####.....#..##.....#..##.....#####.....#...#######.............##########', -- 4: Mug
    '...........####.....##..##....##..########..######.####.##.#......##.#..............................', -- 5: Key
    '.............####...#.######..######.##.#####################.#######....#####......................', -- 6: Fish
    '...####....########.###.##.###############.####.############...#..#......#..#......#..#......####...', -- 7: Mushroom
    '....##......######...########.####################....##........##........##......#.##......####....', -- 8: Umbrella
    '....#.........##........###.......####......#####.....#.....##########.########...######............', -- 9: Sailboat
    '....##.......####......####......#..#......####......####.....######...########..##.##.##.....##....', -- 10: Rocket
    '..######...########.#############.##.######.##.###############.####.#####....###.########...######..', -- 11: Smiley
    '....##.......####......####...####################.########...######....######...###..###..##....##.', -- 12: Star
    '...#######...#######...#.....#...#.....#...#.....#...#.....#.###...#######..########..####.##....##.', -- 13: Music note
    '.....#........#.......##.###...########.######.#########.#############.########..########...##..##..', -- 14: Apple
    '...####....########.############..##..####..##..##################################.##.##.##..#..#..#', -- 15: Ghost
    '..###......#####.....##.###....######...###........####......#########.########...######.....####...', -- 16: Duck
    '....#####....#####....#####....#####....##########....#####....#####....####......###.......##......', -- 17: Lightning
    '#...##...###..##..#####.##.########################.##..##.#####################....................', -- 18: Crown
    '....##.......#..#.......##.....########.....##........##....##..##..####..##..##.########....####...', -- 19: Anchor
    '....##.......####.....######....######....######...########..########.##########..............##....', -- 20: Bell
    '....................####..#####..####..##..#..#..##..#..#..#####..####..............................', -- 21: Glasses
    '.............####.....######...##.##.##.############.####.##.########.##.#..#.###..#..#..#..........', -- 22: Turtle
    '....##.......####.....##..##....######...##.##.##..########...##..##....######.....####.......##....', -- 23: Pine cone
    '.##..##....##..##....##..##....######...########..##.##.##..########...######.....####....##########', -- 24: Bunny
    '###########.######.##.######.#.#######....######.....####.......##........##......######....######..', -- 25: Trophy
    '....#.........##........###...####################....###.......##........#.........................', -- 26: Arrow
    '..######...#####....#####.....####......####......####......####......#####......#####......######..', -- 27: Moon
    '...####.....######....#.##.#....######...##.##.##.##.####.####.####.##...####.....#....#...##....##.', -- 28: Penguin
    '....##.....#.####.#...######...########.####################.########...######...#.####.#.....##....' -- 29: Sun
    -- pixelock-bank:end
  ]::text[]
$$;

comment on function public.pixelock_pictures() is
  'pixelock@1''s pictures, a hundred cells each, row by row. Mirrored by src/lib/games/pixelock-bank.ts.';

-- How many cells the day's picture fills.
create or replace function public.pixelock_ink(p_day bigint)
returns integer language sql immutable set search_path = '' as $$
  select length(p) - length(replace(p, '#', ''))
    from (select (public.pixelock_pictures())[
            (((p_day % cardinality(public.pixelock_pictures())) + cardinality(public.pixelock_pictures()))
              % cardinality(public.pixelock_pictures()))::integer + 1] as p) day
$$;

revoke all on function public.pixelock_ink(bigint) from public;

-- The score a day's moves make, or null when they are not a legal run: a code out
-- of range, a cell already shown, or a move after the run was over (the picture
-- drawn, or the third mistake). Stopping early is legal.
create or replace function public.pixelock_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_pictures text[] := public.pixelock_pictures();
  v_count    integer := cardinality(v_pictures);
  v_picture  text;
  v_shown    boolean[] := array_fill(false, array[100]);
  v_ink      integer;
  v_left     integer;   -- filled cells not yet shown
  v_fills    integer := 0;
  v_mistakes integer := 0;
  v_over     boolean := false;
  v_action   integer;
  v_cell     integer;
  v_inked    boolean;
begin
  v_picture := v_pictures[(((p_day % v_count) + v_count) % v_count)::integer + 1];
  v_ink := length(v_picture) - length(replace(v_picture, '#', ''));
  v_left := v_ink;

  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_over or v_action is null or v_action < 0 or v_action >= 200 then
      return null;
    end if;
    v_cell := v_action / 2;
    if v_shown[v_cell + 1] then
      return null;
    end if;
    v_shown[v_cell + 1] := true;
    v_inked := substr(v_picture, v_cell + 1, 1) = '#';

    if v_inked = (v_action % 2 = 0) then
      if v_inked then
        v_fills := v_fills + 1;
      end if;
    else
      v_mistakes := v_mistakes + 1;
    end if;
    if v_inked then
      v_left := v_left - 1;
    end if;
    if v_left = 0 or v_mistakes >= 3 then
      v_over := true;
    end if;
  end loop;

  if v_left = 0 then
    return v_fills + 50 + 25 * (3 - v_mistakes);
  end if;
  return v_fills;
end;
$$;

comment on function public.pixelock_score(bigint, integer[]) is
  'A Pixelock day''s moves replayed: 1 a cell rightly filled, and 50 + 25 a life left for the whole picture; null when the moves are not a legal run.';

revoke all on function public.pixelock_pictures() from public;
revoke all on function public.pixelock_score(bigint, integer[]) from public;

create or replace function public.complete_pixelock_run(
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
    public.pixelock_rules_version(), public.pixelock_max_actions());
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

  v_score := public.pixelock_score((v_gate.session).seed, p_actions);
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
    -- A drawn picture always scores more than its filled cells: at most three of
    -- them can be shown by mistakes, and the picture adds 50.
    0, v_gate.elapsed, case when v_score > public.pixelock_ink((v_gate.session).seed) then 1 else 0 end,
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_pixelock_run(uuid, integer[], bigint, integer) is
  'Pixelock: replays a day''s moves on the day''s picture and records the score.';

revoke all on function public.complete_pixelock_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_pixelock_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('pixelock', public.pixelock_rules_version(), public.pixelock_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
