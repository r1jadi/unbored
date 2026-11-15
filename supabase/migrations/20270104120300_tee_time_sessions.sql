-- Tee Time (`tee-time@1`): a daily nine-hole golf course, verified by the database.
--
-- The course is built from the day — MINSTD seeded with day × 7919 + 31337, drawn
-- in the same order as the client — and every shot is replayed on it in integer
-- yards: the club's carry × power × the lie, the wind's push, a roll along the
-- line, water and out of bounds costing a stroke, and automatic putts once the ball
-- stops on the green. A finished hole scores max(0, par + 3 − strokes) × 10.
--
--   1. The rules version, the sine table and MINSTD's step.
--   2. `tee_time_course(day)`: the day's nine as jsonb, the same shape the client
--      builds (`buildCourse` in src/lib/games/tee-time.ts), so the two can be
--      compared whole.
--   3. `tee_time_surface(...)`: what the ground is at a point.
--   4. `tee_time_score(day, actions)`: the replay, null for a run that is not legal.
--   5. `complete_tee_time_run`, the verifier, and the registry row. The day seed is
--      `20270104120400_daily_four_start.sql`.
--
-- Nothing a user can see changes until `20270104120500_daily_four_playable.sql`.
-- Mirrored by src/lib/games/tee-time.ts, which explains every rule. `/` here is
-- integer division, truncating toward zero, as the client's `div`.

create or replace function public.tee_time_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'tee-time@1'::text $$;

-- Nine holes, picked up at par + 4 (nine strokes on a par 5), one move a stroke at
-- most.
create or replace function public.tee_time_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 81 $$;

comment on function public.tee_time_rules_version() is 'The Tee Time rules version: tee-time@1.';
comment on function public.tee_time_max_actions() is
  'The most moves one Tee Time submission may carry: nine holes of at most nine shots.';

-- round(sin(a°) × 10000), for any whole angle.
create or replace function public.tee_time_sin(p_angle integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_table constant integer[] := array[
    0, 175, 349, 523, 698, 872, 1045, 1219, 1392, 1564, 1736, 1908, 2079, 2250, 2419, 2588,
    2756, 2924, 3090, 3256, 3420, 3584, 3746, 3907, 4067, 4226, 4384, 4540, 4695, 4848, 5000,
    5150, 5299, 5446, 5592, 5736, 5878, 6018, 6157, 6293, 6428, 6561, 6691, 6820, 6947, 7071,
    7193, 7314, 7431, 7547, 7660, 7771, 7880, 7986, 8090, 8192, 8290, 8387, 8480, 8572, 8660,
    8746, 8829, 8910, 8988, 9063, 9135, 9205, 9272, 9336, 9397, 9455, 9511, 9563, 9613, 9659,
    9703, 9744, 9781, 9816, 9848, 9877, 9903, 9925, 9945, 9962, 9976, 9986, 9994, 9998, 10000];
  v_a integer := ((p_angle % 360) + 360) % 360;
begin
  if v_a <= 90 then return v_table[v_a + 1];
  elsif v_a <= 180 then return v_table[180 - v_a + 1];
  elsif v_a <= 270 then return -v_table[v_a - 180 + 1];
  end if;
  return -v_table[360 - v_a + 1];
end;
$$;

-- One MINSTD step.
create or replace function public.tee_time_next(p_state bigint)
returns bigint language sql immutable set search_path = '' as $$
  select (p_state * 48271) % 2147483647
$$;

create or replace function public.tee_time_course(p_day bigint)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_templates constant integer[] := array[
    4, 3, 5, 4, 4, 3, 4, 5, 4,
    4, 4, 3, 5, 4, 4, 3, 4, 5,
    5, 4, 3, 4, 4, 5, 3, 4, 4,
    4, 3, 4, 4, 5, 3, 4, 4, 5];
  v_ox constant integer[] := array[0, 71, 100, 71, 0, -71, -100, -71];
  v_oy constant integer[] := array[100, 71, 0, -71, -100, -71, 0, 71];
  v_s        bigint;
  v_template integer;
  v_course   jsonb := '[]'::jsonb;
  v_h        integer;
  v_par      integer;
  v_length   integer;
  v_px       integer[];
  v_py       integer[];
  v_green    integer;
  v_fwr      integer;
  v_fairway  jsonb;
  v_bunkers  jsonb;
  v_water    jsonb;
  v_i        integer;
  v_k        integer;
  v_steps    integer;
  v_count    integer;
  v_dir      integer;
  v_dist     integer;
  v_side     integer;
  v_x        integer;
  v_y        integer;
  v_r        integer;
  v_wx       integer;
  v_wy       integer;
  v_n        integer;
begin
  v_s := (p_day * 7919 + 31337) % 2147483647;
  if v_s <= 0 then v_s := v_s + 2147483646; end if;

  v_s := public.tee_time_next(v_s); v_template := (v_s % 4)::integer;

  for v_h in 0..8 loop
    v_par := v_templates[v_template * 9 + v_h + 1];

    if v_par = 3 then
      v_s := public.tee_time_next(v_s); v_length := 110 + (v_s % 80)::integer;
    elsif v_par = 4 then
      v_s := public.tee_time_next(v_s); v_length := 290 + (v_s % 110)::integer;
    else
      v_s := public.tee_time_next(v_s); v_length := 440 + (v_s % 80)::integer;
    end if;

    v_px := array[0];
    v_py := array[0];
    if v_par = 4 then
      v_s := public.tee_time_next(v_s); v_y := 210 + (v_s % 50)::integer;
      v_s := public.tee_time_next(v_s); v_x := (v_s % 91)::integer - 45;
      v_px := v_px || v_x; v_py := v_py || v_y;
      v_s := public.tee_time_next(v_s);
      v_px := v_px || (v_x + (v_s % 81)::integer - 40); v_py := v_py || v_length;
    elsif v_par = 5 then
      v_s := public.tee_time_next(v_s); v_y := 220 + (v_s % 40)::integer;
      v_s := public.tee_time_next(v_s); v_x := (v_s % 81)::integer - 40;
      v_px := v_px || v_x; v_py := v_py || v_y;
      v_s := public.tee_time_next(v_s); v_y := v_y + 110 + (v_s % 30)::integer;
      v_s := public.tee_time_next(v_s); v_x := v_x + (v_s % 81)::integer - 40;
      v_px := v_px || v_x; v_py := v_py || v_y;
      v_s := public.tee_time_next(v_s);
      v_px := v_px || (v_x + (v_s % 61)::integer - 30); v_py := v_py || v_length;
    else
      v_s := public.tee_time_next(v_s);
      v_px := v_px || ((v_s % 41)::integer - 20); v_py := v_py || v_length;
    end if;
    v_n := cardinality(v_px);

    v_s := public.tee_time_next(v_s); v_green := 12 + (v_s % 6)::integer;
    v_s := public.tee_time_next(v_s); v_fwr := 16 + (v_s % 8)::integer;

    v_fairway := '[]'::jsonb;
    if v_par = 3 then
      v_fairway := v_fairway || jsonb_build_array(jsonb_build_object(
        'x', v_px[v_n], 'y', v_py[v_n] - v_green - 4, 'r', 9));
    else
      for v_i in 1..(v_n - 1) loop
        v_steps := greatest(1, (v_py[v_i + 1] - v_py[v_i]) / 15);
        for v_k in 0..v_steps loop
          v_x := v_px[v_i] + ((v_px[v_i + 1] - v_px[v_i]) * v_k) / v_steps;
          v_y := v_py[v_i] + ((v_py[v_i + 1] - v_py[v_i]) * v_k) / v_steps;
          if v_y >= 120 then
            v_fairway := v_fairway || jsonb_build_array(jsonb_build_object(
              'x', v_x, 'y', v_y, 'r', v_fwr));
          end if;
        end loop;
      end loop;
    end if;

    v_bunkers := '[]'::jsonb;
    v_s := public.tee_time_next(v_s); v_count := 1 + (v_s % 3)::integer;
    for v_i in 1..v_count loop
      v_s := public.tee_time_next(v_s); v_dir := (v_s % 8)::integer + 1;
      v_s := public.tee_time_next(v_s); v_dist := v_green + 3 + (v_s % 4)::integer;
      v_s := public.tee_time_next(v_s); v_r := 4 + (v_s % 4)::integer;
      v_bunkers := v_bunkers || jsonb_build_array(jsonb_build_object(
        'x', v_px[v_n] + (v_ox[v_dir] * v_dist) / 100,
        'y', v_py[v_n] + (v_oy[v_dir] * v_dist) / 100,
        'r', v_r));
    end loop;
    if v_par <> 3 then
      v_s := public.tee_time_next(v_s);
      if v_s % 2 = 0 then
        v_s := public.tee_time_next(v_s);
        v_side := case when v_s % 2 = 0 then -1 else 1 end;
        v_s := public.tee_time_next(v_s); v_y := v_py[2] - 10 + (v_s % 20)::integer;
        v_s := public.tee_time_next(v_s); v_r := 6 + (v_s % 4)::integer;
        v_bunkers := v_bunkers || jsonb_build_array(jsonb_build_object(
          'x', v_px[2] + v_side * (v_fwr + 2), 'y', v_y, 'r', v_r));
      end if;
    end if;

    v_water := '[]'::jsonb;
    v_s := public.tee_time_next(v_s);
    if v_s % 3 = 0 then
      if v_par = 3 then
        v_s := public.tee_time_next(v_s); v_x := v_px[v_n] + (v_s % 21)::integer - 10;
        v_s := public.tee_time_next(v_s); v_y := v_py[v_n] - v_green - 12 - (v_s % 10)::integer;
        v_s := public.tee_time_next(v_s); v_r := 9 + (v_s % 6)::integer;
      else
        v_s := public.tee_time_next(v_s);
        v_side := case when v_s % 2 = 0 then -1 else 1 end;
        v_s := public.tee_time_next(v_s); v_x := v_px[2] + v_side * (v_fwr + 14 + (v_s % 10)::integer);
        v_s := public.tee_time_next(v_s); v_y := v_py[2] + (v_s % 40)::integer - 20;
        v_s := public.tee_time_next(v_s); v_r := 14 + (v_s % 8)::integer;
      end if;
      v_water := jsonb_build_array(jsonb_build_object('x', v_x, 'y', v_y, 'r', v_r));
    end if;

    v_s := public.tee_time_next(v_s); v_wx := (v_s % 11)::integer - 5;
    v_s := public.tee_time_next(v_s); v_wy := (v_s % 11)::integer - 5;

    v_course := v_course || jsonb_build_array(jsonb_build_object(
      'par', v_par,
      'length', v_length,
      'pin', jsonb_build_object('x', v_px[v_n], 'y', v_py[v_n]),
      'green', v_green,
      'fairway', v_fairway,
      'bunkers', v_bunkers,
      'water', v_water,
      'wind', jsonb_build_object('x', v_wx, 'y', v_wy),
      'bounds', jsonb_build_object(
        'minX', (select min(x) from unnest(v_px) x) - 70,
        'maxX', (select max(x) from unnest(v_px) x) + 70,
        'minY', -30,
        'maxY', v_length + 35)));
  end loop;
  return v_course;
end;
$$;

comment on function public.tee_time_course(bigint) is
  'The day''s Tee Time nine, built exactly as buildCourse in src/lib/games/tee-time.ts builds it.';

-- Discs as a flat [x, y, r, x, y, r, …] array, for the replay's inner loop.
create or replace function public.tee_time_discs(p_discs jsonb)
returns integer[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(v order by o, k), '{}'::integer[])
    from jsonb_array_elements(p_discs) with ordinality as d(disc, o)
    cross join lateral (values (1, (d.disc ->> 'x')::integer),
                               (2, (d.disc ->> 'y')::integer),
                               (3, (d.disc ->> 'r')::integer)) as t(k, v)
$$;

-- The ground at a point: 0 tee, 1 fairway, 2 rough, 3 bunker, 4 green, 5 water,
-- 6 out of bounds. The order of the tests is the client's `surfaceAt`.
create or replace function public.tee_time_surface(
  p_bounds  integer[],
  p_pin_x   integer,
  p_pin_y   integer,
  p_green   integer,
  p_water   integer[],
  p_bunkers integer[],
  p_fairway integer[],
  p_x       integer,
  p_y       integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_i integer;
begin
  if p_x < p_bounds[1] or p_x > p_bounds[2] or p_y < p_bounds[3] or p_y > p_bounds[4] then
    return 6;
  end if;
  if (p_x - p_pin_x) * (p_x - p_pin_x) + (p_y - p_pin_y) * (p_y - p_pin_y) <= p_green * p_green then
    return 4;
  end if;
  v_i := 1;
  while v_i <= cardinality(p_water) loop
    if (p_x - p_water[v_i]) * (p_x - p_water[v_i]) + (p_y - p_water[v_i + 1]) * (p_y - p_water[v_i + 1])
       <= p_water[v_i + 2] * p_water[v_i + 2] then
      return 5;
    end if;
    v_i := v_i + 3;
  end loop;
  v_i := 1;
  while v_i <= cardinality(p_bunkers) loop
    if (p_x - p_bunkers[v_i]) * (p_x - p_bunkers[v_i]) + (p_y - p_bunkers[v_i + 1]) * (p_y - p_bunkers[v_i + 1])
       <= p_bunkers[v_i + 2] * p_bunkers[v_i + 2] then
      return 3;
    end if;
    v_i := v_i + 3;
  end loop;
  if p_x * p_x + p_y * p_y <= 25 then
    return 0;
  end if;
  v_i := 1;
  while v_i <= cardinality(p_fairway) loop
    if (p_x - p_fairway[v_i]) * (p_x - p_fairway[v_i]) + (p_y - p_fairway[v_i + 1]) * (p_y - p_fairway[v_i + 1])
       <= p_fairway[v_i + 2] * p_fairway[v_i + 2] then
      return 1;
    end if;
    v_i := v_i + 3;
  end loop;
  return 2;
end;
$$;

-- The score a day's shots make, or null when they are not a legal run: a code that
-- is not a shot, or a shot after the ninth hole is done. Stopping mid-round is
-- ending the run, and is legal; an unfinished hole scores nothing.
create or replace function public.tee_time_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_carries constant integer[] := array[250, 215, 185, 160, 135, 110, 80, 45];
  -- By surface code: tee, fairway, rough, bunker, green, water, out.
  v_lie     constant integer[] := array[100, 100, 80, 60, 100, 0, 0];
  v_rollpct constant integer[] := array[12, 12, 4, 0, 8, 0, 0];
  v_course  jsonb := public.tee_time_course(p_day);
  v_hole    jsonb;
  v_h       integer := 0;
  v_par     integer;
  v_bounds  integer[];
  v_pin_x   integer;
  v_pin_y   integer;
  v_green   integer;
  v_water   integer[];
  v_bunkers integer[];
  v_fairway integer[];
  v_wind_x  integer;
  v_wind_y  integer;
  v_bx      integer := 0;
  v_by      integer := 0;
  v_strokes integer := 0;
  v_score   bigint := 0;
  v_action  integer;
  v_club    integer;
  v_angle   integer;
  v_power   integer;
  v_carry   integer;
  v_dx      integer;
  v_dy      integer;
  v_lx      integer;
  v_ly      integer;
  v_landed  integer;
  v_roll    integer;
  v_x       integer;
  v_y       integer;
  v_qx      integer;
  v_qy      integer;
  v_ground  integer;
  v_k       integer;
  v_cap     integer;
  v_putts   integer;
  v_d2      integer;
  v_total   integer;
  v_loaded  integer := -1;
begin
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_h >= 9 or v_action < 0 or v_action >= 8 * 36000 then
      return null;
    end if;

    if v_loaded <> v_h then
      v_hole := v_course -> v_h;
      v_par := (v_hole ->> 'par')::integer;
      v_bounds := array[
        (v_hole -> 'bounds' ->> 'minX')::integer, (v_hole -> 'bounds' ->> 'maxX')::integer,
        (v_hole -> 'bounds' ->> 'minY')::integer, (v_hole -> 'bounds' ->> 'maxY')::integer];
      v_pin_x := (v_hole -> 'pin' ->> 'x')::integer;
      v_pin_y := (v_hole -> 'pin' ->> 'y')::integer;
      v_green := (v_hole ->> 'green')::integer;
      v_water := public.tee_time_discs(v_hole -> 'water');
      v_bunkers := public.tee_time_discs(v_hole -> 'bunkers');
      v_fairway := public.tee_time_discs(v_hole -> 'fairway');
      v_wind_x := (v_hole -> 'wind' ->> 'x')::integer;
      v_wind_y := (v_hole -> 'wind' ->> 'y')::integer;
      v_loaded := v_h;
    end if;

    v_club := v_action / 36000;
    v_angle := (v_action / 100) % 360;
    v_power := v_action % 100 + 1;

    v_ground := public.tee_time_surface(v_bounds, v_pin_x, v_pin_y, v_green,
                                        v_water, v_bunkers, v_fairway, v_bx, v_by);
    v_carry := (v_carries[v_club + 1] * v_power * v_lie[v_ground + 1]) / 10000;
    v_dx := public.tee_time_sin(v_angle);
    v_dy := public.tee_time_sin(v_angle + 90);
    v_lx := v_bx + (v_dx * v_carry) / 10000 + (v_wind_x * v_carry) / 100;
    v_ly := v_by + (v_dy * v_carry) / 10000 + (v_wind_y * v_carry) / 100;
    v_strokes := v_strokes + 1;
    v_landed := public.tee_time_surface(v_bounds, v_pin_x, v_pin_y, v_green,
                                        v_water, v_bunkers, v_fairway, v_lx, v_ly);

    if v_landed = 5 or v_landed = 6 then
      -- Stroke and distance: played again from where it was.
      v_strokes := v_strokes + 1;
      v_x := v_bx;
      v_y := v_by;
    else
      v_roll := (v_carry * v_rollpct[v_landed + 1]) / 100;
      v_x := v_lx;
      v_y := v_ly;
      v_k := 1;
      while v_k <= v_roll loop
        v_qx := v_lx + (v_dx * v_k) / 10000;
        v_qy := v_ly + (v_dy * v_k) / 10000;
        v_ground := public.tee_time_surface(v_bounds, v_pin_x, v_pin_y, v_green,
                                            v_water, v_bunkers, v_fairway, v_qx, v_qy);
        if v_ground = 5 or v_ground = 6 then
          v_strokes := v_strokes + 1;
          exit;
        end if;
        v_x := v_qx;
        v_y := v_qy;
        exit when v_ground = 3;
        v_k := v_k + 1;
      end loop;
    end if;

    v_cap := v_par + 4;
    v_ground := public.tee_time_surface(v_bounds, v_pin_x, v_pin_y, v_green,
                                        v_water, v_bunkers, v_fairway, v_x, v_y);
    if v_ground = 4 or v_strokes >= v_cap then
      v_putts := 0;
      if v_ground = 4 then
        v_d2 := (v_x - v_pin_x) * (v_x - v_pin_x) + (v_y - v_pin_y) * (v_y - v_pin_y);
        v_putts := case when v_d2 <= 1 then 0 when v_d2 <= 9 then 1 when v_d2 <= 81 then 2 else 3 end;
      end if;
      v_total := least(v_cap, v_strokes + v_putts);
      v_score := v_score + greatest(0, v_par + 3 - v_total) * 10;
      v_h := v_h + 1;
      v_bx := 0;
      v_by := 0;
      v_strokes := 0;
    else
      v_bx := v_x;
      v_by := v_y;
    end if;
  end loop;
  return v_score;
end;
$$;

comment on function public.tee_time_score(bigint, integer[]) is
  'A Tee Time day''s shots replayed on the day''s course: max(0, par + 3 − strokes) × 10 a finished hole; null when a code is not a shot or the round was already over.';

revoke all on function public.tee_time_sin(integer) from public;
revoke all on function public.tee_time_next(bigint) from public;
revoke all on function public.tee_time_course(bigint) from public;
revoke all on function public.tee_time_discs(jsonb) from public;
revoke all on function public.tee_time_surface(integer[], integer, integer, integer, integer[], integer[], integer[], integer, integer) from public;
revoke all on function public.tee_time_score(bigint, integer[]) from public;

create or replace function public.complete_tee_time_run(
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
    public.tee_time_rules_version(), public.tee_time_max_actions());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

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

  v_score := public.tee_time_score((v_gate.session).seed, p_actions);
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
    0, v_gate.elapsed, 0, coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_tee_time_run(uuid, integer[], bigint, integer) is
  'Tee Time: replays a day''s shots on the day''s course and records the score.';

revoke all on function public.complete_tee_time_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_tee_time_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('tee-time', public.tee_time_rules_version(), public.tee_time_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
