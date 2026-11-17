-- Meander (`meander@1`): one theme a day, its words wound through a 5 × 5 grid,
-- verified by the database.
--
-- The words are hidden; the board shows the theme and each word's length. Every
-- word runs through side-by-side cells, and together they use every letter once.
-- A traced word that is one of the day's is placed on the cells traced; a placed
-- word can be lifted again, and up to three hints each show a word.
--
--   1. The rules version, the bound on a submission, and the bank: each puzzle's
--      letters and words, written by `bun scripts/generate-daily-banks.ts --write`
--      from `src/lib/games/meander-bank.ts`.
--   2. `meander_score(day, actions)`: the replay, null for a run that is not legal.
--   3. `complete_meander_run`, the verifier: the generic gate, one completion a day
--      (`already_played`), the replay, and `speed_run_finish` with no par.
--   4. The registry row. The day seed is `20270113120100_meander_start.sql`.
--
-- Nothing a user can see changes: `20270113120200_meander_playable.sql` flips the
-- catalogue and lands last. Mirrored by src/lib/games/meander.ts. See
-- docs/games/README.md.

create or replace function public.meander_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'meander@1'::text $$;

create or replace function public.meander_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 256 $$;

comment on function public.meander_rules_version() is 'The Meander rules version: meander@1.';
comment on function public.meander_max_actions() is
  'The most moves one Meander submission may carry: 256.';

create or replace function public.meander_puzzle_count()
returns integer language sql immutable set search_path = '' as $$
  select
    -- meander-count:begin
    40
    -- meander-count:end
$$;

create or replace function public.meander_puzzle_for(p_day bigint)
returns integer language sql immutable set search_path = '' as $$
  select (((p_day % public.meander_puzzle_count()) + public.meander_puzzle_count())
          % public.meander_puzzle_count())::integer
$$;

-- A puzzle: element 1 is the grid's 25 letters row by row, the rest its words in
-- the day's order (word i is element i + 2).
create or replace function public.meander_puzzle(p_puzzle integer)
returns text[] language sql immutable set search_path = '' as $$
  select case p_puzzle
    -- meander-bank:begin
    when 0 then array['LIMUCEMPLHABRRENAYMAANOGN', 'BANANA', 'CHERRY', 'MANGO', 'PLUM', 'LIME']
    when 1 then array['RYDLCAIUOTWNTUHOBSNRFRODE', 'THUNDER', 'RAINBOW', 'CLOUDY', 'FROST']
    when 2 then array['EHWRCLATEOEYSARDOKLSITRAH', 'WHALE', 'SHARK', 'CORAL', 'OYSTER', 'TIDE']
    when 3 then array['SRSAOPETKTOOORENNFIFEVONK', 'SPOON', 'KNIFE', 'FORK', 'TOASTER', 'OVEN']
    when 4 then array['NRUMESATCRJUSURIPUNYTEREV', 'MERCURY', 'JUPITER', 'SATURN', 'VENUS']
    when 5 then array['TORGEELANEARWPLCLORUSLEYP', 'SCARLET', 'PURPLE', 'ORANGE', 'YELLOW']
    when 6 then array['ONGUIIANATPLIRCIONILVTERA', 'CLARINET', 'GUITAR', 'VIOLIN', 'PIANO']
    when 7 then array['HOEYERRSNKOONODRSEKCETCHI', 'ROOSTER', 'CHICKEN', 'DONKEY', 'HORSE']
    when 8 then array['LLABFSASOLIBEGTNNRIETECCK', 'CRICKET', 'BASEBALL', 'TENNIS', 'GOLF']
    when 9 then array['WLEANOBELKHCSREMAHODOTSUL', 'SHOULDER', 'STOMACH', 'ELBOW', 'ANKLE']
    when 10 then array['EWOLCLPILEMAWADEPHRBNICRI', 'WILLOW', 'MAPLE', 'BIRCH', 'CEDAR', 'PINE']
    when 11 then array['PORTOEIRSAGDPTNKEABOACNAC', 'PANCAKE', 'PORRIDGE', 'BACON', 'TOAST']
    when 12 then array['TEHTMCKMOOIRBQSECEUILTEOT', 'MOSQUITO', 'CRICKET', 'BEETLE', 'MOTH']
    when 13 then array['CEEGATLYBBOERACRROPOCATAT', 'CABBAGE', 'CARROT', 'POTATO', 'CELERY']
    when 14 then array['PENLAGNOCFUIPIGPNOTEARRNO', 'PENGUIN', 'PARROT', 'PIGEON', 'FALCON']
    when 15 then array['SDAECUNEIOMUEKONFINWIFBRO', 'BROWNIE', 'COOKIE', 'MUFFIN', 'SUNDAE']
    when 16 then array['REREMNNHAMAPSCLPLIHESREIS', 'SPANNER', 'HAMMER', 'CHISEL', 'PLIERS']
    when 17 then array['FRTRORACSUETEESEAVRSWSOLG', 'SWEATER', 'TROUSERS', 'SCARF', 'GLOVE']
    when 18 then array['DIOTSTEREATKCGAEMORLCOYXA', 'ASTEROID', 'GALAXY', 'COMET', 'ROCKET']
    when 19 then array['EGECNPYFRATPLIZROALATUGBR', 'PORTUGAL', 'FRANCE', 'BRAZIL', 'EGYPT']
    when 20 then array['REAEDRHCTOEBPTCPMIORLULOT', 'PLUMBER', 'TEACHER', 'DOCTOR', 'PILOT']
    when 21 then array['EMALDDERCRIANDYRMOTSUBYAL', 'DIAMOND', 'EMERALD', 'CRYSTAL', 'RUBY']
    when 22 then array['ELGTRELNAITCRESRCIRQAEHAU', 'TRIANGLE', 'CIRCLE', 'SQUARE', 'HEART']
    when 23 then array['COTENNMPATRETSBLTESLANKNA', 'LANTERN', 'COMPASS', 'BLANKET', 'TENT']
    when 24 then array['TNETKIBBTIHAAGLSMREITERRB', 'HAMSTER', 'RABBIT', 'KITTEN', 'GERBIL']
    when 25 then array['SWEKNHORSIPMRORAIRLEOSTOW', 'SHOWER', 'MIRROR', 'TOWEL', 'SOAP', 'SINK']
    when 26 then array['TSOTERCOERACTLCOTABYRIXIC', 'BICYCLE', 'SCOOTER', 'TRACTOR', 'TAXI']
    when 27 then array['YTREDELLSERVACAEGLYNICAON', 'GLACIER', 'CANYON', 'VALLEY', 'DESERT']
    when 28 then array['RTOAZITPIZSOAPIALNANSAGNI', 'LASAGNA', 'RISOTTO', 'PANINI', 'PIZZA']
    when 29 then array['PREDFEILLONCRELERAAPRESTS', 'STAPLER', 'PENCIL', 'FOLDER', 'ERASER']
    when 30 then array['GARNILREGGICORPGEREEANOPP', 'OREGANO', 'GINGER', 'PEPPER', 'GARLIC']
    when 31 then array['BAJIVALLEESLZTTSATOAWALGN', 'BALLET', 'TANGO', 'SALSA', 'WALTZ', 'JIVE']
    when 32 then array['POIBGNHSINWAPKNTKNQEHGIUE', 'KNIGHT', 'BISHOP', 'QUEEN', 'KING', 'PAWN']
    when 33 then array['PUTORILIHCPADYLSNYSIYDAIL', 'ORCHID', 'TULIP', 'DAISY', 'PANSY', 'LILY']
    when 34 then array['ESHEBDALLUSPEKCDNTSESAWAV', 'BUCKET', 'WAVES', 'SHELL', 'SPADE', 'SAND']
    when 35 then array['MTENSITAMNSLNWOEEIELGDCIC', 'SNOWMAN', 'SLEDGE', 'ICICLE', 'MITTEN']
    when 36 then array['ANCREPAHORSRRSUWDOAEORTTR', 'TREASURE', 'PARROT', 'ANCHOR', 'SWORD']
    when 37 then array['TANLROBOIERCAGLEPAGUZERTJ', 'TRAPEZE', 'JUGGLER', 'ACROBAT', 'LION']
    when 38 then array['ATAHMISLCORAATTOBRPESSESE', 'ESPRESSO', 'BARISTA', 'LATTE', 'MOCHA']
    when 39 then array['DCASERIWTLAZUNIDGONCRANRO', 'UNICORN', 'CASTLE', 'DRAGON', 'WIZARD']
    -- meander-bank:end
  end
$$;

comment on function public.meander_puzzle(integer) is
  'meander@1''s grids and words by puzzle. Mirrored by src/lib/games/meander-bank.ts.';

-- The score a day's moves make, or null when they are not a legal run.
--
--   0        a hint: the first word neither placed nor hinted; three at most.
--   1 + i    lift word i, which must be placed.
--   >= 100   a trace: start + 25 * length + 400 * sum(direction_k * 4^k), length
--            4 to 8, direction 0 up, 1 right, 2 down, 3 left. It must stay on the
--            grid, touch no cell twice and no placed word, and spell a word of the
--            day's not yet placed (the first such, in the day's order).
--
-- Placing the last word ends the run; any move after that is not legal. Stopping
-- early is.
create or replace function public.meander_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bank    text[] := public.meander_puzzle(public.meander_puzzle_for(p_day));
  v_letters text := v_bank[1];
  v_n       integer := cardinality(v_bank) - 1;
  v_owner   integer[] := array_fill(-1, array[25]);
  v_placed  boolean[] := array_fill(false, array[8]);
  v_hinted  boolean[] := array_fill(false, array[8]);
  v_hints   integer := 0;
  v_count   integer := 0;
  v_over    boolean := false;
  v_action  integer;
  v_word    integer;
  v_start   integer;
  v_len     integer;
  v_dirs    integer;
  v_dir     integer;
  v_cell    integer;
  v_next    integer;
  v_cells   integer[];
  v_spelled text;
  v_k       integer;
begin
  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_over or v_action is null or v_action < 0 then
      return null;
    end if;

    if v_action = 0 then
      -- A hint.
      if v_hints >= 3 then
        return null;
      end if;
      v_word := null;
      for v_k in 0..v_n - 1 loop
        if not v_placed[v_k + 1] and not v_hinted[v_k + 1] then
          v_word := v_k;
          exit;
        end if;
      end loop;
      if v_word is null then
        return null;
      end if;
      v_hinted[v_word + 1] := true;
      v_hints := v_hints + 1;

    elsif v_action <= 8 then
      -- Lift a placed word.
      v_word := v_action - 1;
      if v_word >= v_n or not v_placed[v_word + 1] then
        return null;
      end if;
      v_placed[v_word + 1] := false;
      for v_k in 1..25 loop
        if v_owner[v_k] = v_word then
          v_owner[v_k] := -1;
        end if;
      end loop;
      v_count := v_count - 1;

    elsif v_action >= 100 then
      -- A trace.
      v_start := v_action % 25;
      v_len := (v_action / 25) % 16;
      v_dirs := v_action / 400;
      if v_len < 4 or v_len > 8 or v_dirs >= (4 ^ (v_len - 1))::integer then
        return null;
      end if;
      v_cell := v_start;
      v_cells := array[v_cell];
      v_spelled := substr(v_letters, v_cell + 1, 1);
      for v_k in 1..v_len - 1 loop
        v_dir := v_dirs % 4;
        v_dirs := v_dirs / 4;
        if (v_dir = 0 and v_cell / 5 = 0) or (v_dir = 1 and v_cell % 5 = 4)
           or (v_dir = 2 and v_cell / 5 = 4) or (v_dir = 3 and v_cell % 5 = 0) then
          return null;   -- off the grid
        end if;
        v_next := v_cell + case v_dir when 0 then -5 when 1 then 1 when 2 then 5 else -1 end;
        if v_next = any(v_cells) then
          return null;   -- a cell twice
        end if;
        v_cell := v_next;
        v_cells := v_cells || v_cell;
        v_spelled := v_spelled || substr(v_letters, v_cell + 1, 1);
      end loop;
      foreach v_cell in array v_cells loop
        if v_owner[v_cell + 1] <> -1 then
          return null;   -- on a placed word
        end if;
      end loop;
      v_word := null;
      for v_k in 0..v_n - 1 loop
        if not v_placed[v_k + 1] and v_bank[v_k + 2] = v_spelled then
          v_word := v_k;
          exit;
        end if;
      end loop;
      if v_word is null then
        return null;   -- not one of the day's words
      end if;
      v_placed[v_word + 1] := true;
      foreach v_cell in array v_cells loop
        v_owner[v_cell + 1] := v_word;
      end loop;
      v_count := v_count + 1;
      if v_count = v_n then
        v_over := true;
      end if;

    else
      return null;
    end if;
  end loop;

  if v_count = v_n then
    return v_count * 10 + 50 + 25 * (3 - v_hints);
  end if;
  return v_count * 10;
end;
$$;

comment on function public.meander_score(bigint, integer[]) is
  'A Meander day''s moves replayed: 10 a placed word, and 50 plus 25 a hint not taken when the grid is filled; null when the moves are not a legal run.';

revoke all on function public.meander_puzzle(integer) from public;
revoke all on function public.meander_score(bigint, integer[]) from public;

create or replace function public.complete_meander_run(
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
    public.meander_rules_version(), public.meander_max_actions());
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

  v_score := public.meander_score((v_gate.session).seed, p_actions);
  if v_score is null then
    v_result.outcome := 'invalid_actions';
    return v_result;
  end if;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  -- A filled grid scores at least 90 (four words, three hints) and a stopped run at
  -- most 40 (four words of five), so the score alone says whether it was solved.
  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    0, v_gate.elapsed, case when v_score >= 90 then 1 else 0 end,
    coalesce(cardinality(p_actions), 0), p_duration_ms);
end;
$$;

comment on function public.complete_meander_run(uuid, integer[], bigint, integer) is
  'Meander: replays a day''s moves on its grid and records the score.';

revoke all on function public.complete_meander_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_meander_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('meander', public.meander_rules_version(), public.meander_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
