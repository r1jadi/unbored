-- Mini Sudoku (`mini-sudoku@1`): the 6×6 Sudoku, verified by the database.
--
-- Fill a 6×6 grid so every row, every column and every 2×3 box (two rows tall,
-- three wide) holds 1 to 6 once each. Boards come from a bank of unique puzzles,
-- disguised by a seeded shuffle, and a run is a race against one clock that every
-- solved board winds back — the endless, tapered shape Sudoku, Tango and Zip play.
--
-- This migration adds the rules, the puzzle bank, the board draw, the verifier
-- (`complete_mini_sudoku_run`) and teaches the start gate the (`mini-sudoku`,
-- `mini-sudoku@1`) pair. It is only half the feature, so nothing a user can see
-- changes: `20261126120100_mini_sudoku_playable.sql` flips the catalogue and lands
-- last, once the service that routes `mini-sudoku@` runs to the new verifier and
-- the client that plays it are deployed. See docs/games/README.md.
--
-- Mirrored by src/lib/games/mini-sudoku.ts; the boards and scored lines in
-- src/lib/games/mini-sudoku.test.ts are the ones tests/security/rls_test.sql
-- asserts.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mini_sudoku_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'mini-sudoku@1'::text $$;

create or replace function public.mini_sudoku_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

create or replace function public.mini_sudoku_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 15000 $$;

comment on function public.mini_sudoku_rules_version() is
  'The Mini Sudoku rules version new runs pin: mini-sudoku@1.';
comment on function public.mini_sudoku_max_actions() is
  'The most moves one Mini Sudoku submission may carry: a request ceiling, not a final board.';
comment on function public.mini_sudoku_slack_ms() is
  'How late after its clock ran out a Mini Sudoku run is still accepted.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The puzzle bank: four tiers of 30 unique puzzles, 36 digits each, 0 empty
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.mini_sudoku_bank()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- bank:begin
    -- gentle
    '056001012645020006001250260004034060',
    '304600020301400032100006503200201563',
    '000650406213300400064000540362030045',
    '140520500100316002400013601240200001',
    '631025502300000504350261003600000043',
    '040365003020060231001540210053005600',
    '364021000063500104103002001205050310',
    '510004000510006123320005040200265041',
    '456003001060000000035421560042142006',
    '200004610000160305040210036001021653',
    '102450000160625300400520013000546001',
    '500000024106001064640010405030132605',
    '540000102534200601601423005006000015',
    '200354350201061400403015000003032006',
    '015006604315100053050641002000461000',
    '064002020060102604643021000000035146',
    '004010123540000400010053260034300625',
    '302006504000003462206153000030635010',
    '042060105023530002024500210304400006',
    '002501010004306412000300235006041250',
    '610053050026005610020000534001061305',
    '204061501402400010605304040050002106',
    '600042003015052400040051564100201500',
    '054320000400500100001056435602160034',
    '000601001053016042450100025304640200',
    '140253003040000562600014005430030620',
    '600350450000300240245010000520062431',
    '005620230501302400504002420006600014',
    '050403413065000000106054060502045630',
    '036450520630060500305026010005053200',
    -- easy
    '043200020460031000050100000010312045',
    '601005003060130026002500506000324000',
    '201000005000000301314600052103003450',
    '000040000102500300043200036450015603',
    '100452000060502640610305200500006000',
    '040502200000013065020103030450060300',
    '605020030650403002250410020106000000',
    '601500000601560004003206200000405102',
    '600000043600150320062005030560000043',
    '023000405000300000102650061504004106',
    '450200263054000042504001000300015000',
    '045300123005000000401230500020230004',
    '105200006050000503403600502460004300',
    '102030400521060305013040000060021000',
    '513642460035100006006003000500040000',
    '000250532600010326000000024530001002',
    '010020000014140206030400350100401300',
    '003400100000325041000305004003600254',
    '000000326040103020000530640350035600',
    '065100004006500021002034030060250003',
    '043000005001502004000512604003000645',
    '050013030605006102003546000004020060',
    '006005204030000400300560400026623004',
    '000613000000400065030024046250501030',
    '000000432061600400024010300052005034',
    '210504304001040020032605023400000000',
    '100250060030050624206000010062603000',
    '000010005006064005002600531200420150',
    '051000032400305106106053003000000301',
    '100000460500540000306045600150200406',
    -- medium
    '000645000200234000060000300060602530',
    '000200040100305600400020510400034001',
    '000063003025154000000500002306000014',
    '150260020050402600006000000403000026',
    '000002003000205400034000360205500310',
    '510340204000000600400500150000043050',
    '050234000060200000063100100050502600',
    '600004000000036041004206500412400000',
    '000046000230065420000500300604500010',
    '000000006034003500200306604050152000',
    '200000304002620500500020000065056004',
    '062000000250001400340120000000603501',
    '004030321065040120000000010500050010',
    '130042020061000013041006000000052000',
    '306500024000631000050130000020040300',
    '002300030605350000006000600502015030',
    '500000000000000124102006205040463001',
    '002004060002035106010200020030000021',
    '520004463000004000600010140503006000',
    '010020500130100400400002050301000045',
    '416002030406000004040100001300004200',
    '020510500000010600040002100060406031',
    '060040004300000253500100600000042605',
    '000004500310016205003640000420000003',
    '000350000241200010001060500004014020',
    '000006020540500600000135400300031002',
    '040305000000013240000003005021201004',
    '000030130004010000000502645000321600',
    '305600002300600230010000400063006020',
    '100003000025000300054010042530001600',
    -- hard
    '600203000000130060005000043001000504',
    '001650060000604000000160000206000410',
    '300020000605000012000460020050060200',
    '010005540620100060204000050000000400',
    '000306130450060040050000000000540100',
    '000150000000002000450203041060500400',
    '010600300001000506001000004003036005',
    '000004500003201050060000602310000002',
    '000320052010004000500600000500060240',
    '030041000050150600000000000003025064',
    '051030020000000562000013000000032050',
    '004010300000000020500030005041100360',
    '200100001402003040040005030000005003',
    '003000005010000103300054200001100400',
    '100004000001600010010520024000060040',
    '061400000210503000020050000060005300',
    '000530000200600105500040400003061000',
    '500100004265000002005640040000300000',
    '100000506041000300200000002034001050',
    '000030605010020400050300000003340500',
    '300240400030000001050024006050040000',
    '100503006020600000000000004002260014',
    '234000000000600015405062000600001000',
    '405100000003500000103006000034320000',
    '401025600140000030004001000200006000',
    '000240040300020163010000005000000602',
    '000160010030000000004020600500150206',
    '400000000040006000054120021450000002',
    '000000000504500260006003040020015300',
    '002000540020203410010200060000000030'
    -- bank:end
  ]::text[]
$$;

comment on function public.mini_sudoku_bank() is
  'The mini-sudoku@1 puzzle bank: four tiers of 30 unique puzzles (gentle 19 givens, easy 16, medium 14, hard 12). Mirrored by src/lib/games/mini-sudoku-bank.ts.';

-- The tier a level's board is drawn from: 0 gentle, 1 easy, 2 medium, 3 hard.
create or replace function public.mini_sudoku_tier(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Mini Sudoku level is one or more' using errcode = '22023';
  end if;
  return case when p_level <= 2 then 0 when p_level <= 5 then 1 when p_level <= 9 then 2 else 3 end;
end;
$$;

-- The time a board of a tier is given: 60, 75, 105 and 135 seconds.
create or replace function public.mini_sudoku_allowance_ms(p_tier integer)
returns bigint language sql immutable set search_path = '' as $$
  select case p_tier when 0 then 60000 when 1 then 75000 when 2 then 105000 else 135000 end::bigint
$$;

-- The clock a run has earned with `p_cleared` boards solved: two minutes, plus,
-- for every solved board, the allowance of the board after it, tapered by the
-- board just solved (`clock_taper_pct`, the same taper as the other timed games).
create or replace function public.mini_sudoku_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 120000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total
             + public.mini_sudoku_allowance_ms(public.mini_sudoku_tier(v_level + 1))
               * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_total;
end;
$$;

comment on function public.mini_sudoku_tier(integer) is
  'The bank tier a Mini Sudoku level draws from: boards 1–2 gentle (0), 3–5 easy (1), 6–9 medium (2), then hard (3).';
comment on function public.mini_sudoku_allowance_ms(integer) is
  'The time a Mini Sudoku board of a tier is given: 60, 75, 105 and 135 seconds.';
comment on function public.mini_sudoku_budget_ms(integer) is
  'The clock a mini-sudoku@1 run has earned: 120 s plus the next board''s allowance for every solved board, tapered by clock_taper_pct.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A board: a bank puzzle, disguised
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as every endless puzzle draws. The draws come in this order, every
-- shuffle Fisher–Yates from the last index down with j = draw() mod (i + 1):
--
--   1. the puzzle: entry draw() mod 30 of the level's tier;
--   2. the digits 1..6 (digit d becomes digits[d]);
--   3. the rows: the three bands, then the two rows within each band, band by
--      band in the band order just drawn;
--   4. the columns: the two stacks, then the three columns within each stack,
--      stack by stack in the stack order just drawn.
--
-- The board's cell (r, c) is the puzzle's cell (rows[r], columns[c]), relabelled.

create or replace function public.mini_sudoku_start(
  p_seed  bigint,
  p_level integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_puzzle  text;
  v_digits  integer[] := array[1, 2, 3, 4, 5, 6];
  v_groups  integer[];
  v_within  integer[];
  v_rows    integer[] := array[]::integer[];
  v_columns integer[] := array[]::integer[];
  v_group   integer;
  v_index   integer;
  v_swap    integer;
  v_held    integer;
  v_row     integer;
  v_column  integer;
  v_digit   integer;
  v_start   integer[] := array[]::integer[];
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'mini sudoku level is outside the reachable run' using errcode = '22023';
  end if;

  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  -- 1. The puzzle.
  v_state := (v_state * 22695477 + 1) % 4294967296;
  v_puzzle := (public.mini_sudoku_bank())[public.mini_sudoku_tier(p_level) * 30 + ((v_state >> 16) % 30)::integer + 1];

  -- 2. The digits.
  for v_index in reverse 5..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_swap := ((v_state >> 16) % (v_index + 1))::integer;
    v_held := v_digits[v_index + 1];
    v_digits[v_index + 1] := v_digits[v_swap + 1];
    v_digits[v_swap + 1] := v_held;
  end loop;

  -- 3. The rows: three bands of two.
  v_groups := array[0, 1, 2];
  for v_index in reverse 2..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_swap := ((v_state >> 16) % (v_index + 1))::integer;
    v_held := v_groups[v_index + 1];
    v_groups[v_index + 1] := v_groups[v_swap + 1];
    v_groups[v_swap + 1] := v_held;
  end loop;
  for v_group in 1..3 loop
    v_within := array[0, 1];
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_swap := ((v_state >> 16) % 2)::integer;
    v_held := v_within[2];
    v_within[2] := v_within[v_swap + 1];
    v_within[v_swap + 1] := v_held;
    for v_index in 1..2 loop
      v_rows := v_rows || (v_groups[v_group] * 2 + v_within[v_index]);
    end loop;
  end loop;

  -- 4. The columns: two stacks of three.
  v_groups := array[0, 1];
  v_state := (v_state * 22695477 + 1) % 4294967296;
  v_swap := ((v_state >> 16) % 2)::integer;
  v_held := v_groups[2];
  v_groups[2] := v_groups[v_swap + 1];
  v_groups[v_swap + 1] := v_held;
  for v_group in 1..2 loop
    v_within := array[0, 1, 2];
    for v_index in reverse 2..1 loop
      v_state := (v_state * 22695477 + 1) % 4294967296;
      v_swap := ((v_state >> 16) % (v_index + 1))::integer;
      v_held := v_within[v_index + 1];
      v_within[v_index + 1] := v_within[v_swap + 1];
      v_within[v_swap + 1] := v_held;
    end loop;
    for v_index in 1..3 loop
      v_columns := v_columns || (v_groups[v_group] * 3 + v_within[v_index]);
    end loop;
  end loop;

  for v_row in 0..5 loop
    for v_column in 0..5 loop
      v_digit := substr(v_puzzle, v_rows[v_row + 1] * 6 + v_columns[v_column + 1] + 1, 1)::integer;
      v_start := v_start || case when v_digit = 0 then 0 else v_digits[v_digit] end;
    end loop;
  end loop;

  return v_start;
end;
$$;

comment on function public.mini_sudoku_start(bigint, integer) is
  'A mini-sudoku@1 board''s starting cells (36 values, 0 empty): a puzzle from the level''s bank tier, relabelled and shuffled. Mirrored by src/lib/games/mini-sudoku.ts.';

revoke all on function public.mini_sudoku_start(bigint, integer) from public;

-- Whether 36 cells (1-based, reading order) are a solved grid: every cell filled,
-- and every row, column and 2×3 box holds each of 1 to 6. A unit's digits as bits
-- 1..6 must make 126.
create or replace function public.mini_sudoku_solved(p_cells integer[])
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_unit   integer;
  v_index  integer;
  v_value  integer;
  v_row    integer;
  v_column integer;
  v_box    integer;
begin
  if p_cells is null or coalesce(array_length(p_cells, 1), 0) <> 36 then
    return false;
  end if;
  for v_unit in 0..5 loop
    v_row := 0;
    v_column := 0;
    v_box := 0;
    for v_index in 0..5 loop
      v_value := p_cells[v_unit * 6 + v_index + 1];
      if v_value is null or v_value < 1 or v_value > 6 then
        return false;
      end if;
      v_row := v_row | (1 << v_value);
      v_column := v_column | (1 << p_cells[v_index * 6 + v_unit + 1]);
      -- Box v_unit: two rows tall, three columns wide; boxes read left to right,
      -- top to bottom.
      v_box := v_box | (1 << p_cells[((v_unit / 2) * 2 + v_index / 3) * 6
                                     + (v_unit % 2) * 3 + v_index % 3 + 1]);
    end loop;
    if v_row <> 126 or v_column <> 126 or v_box <> 126 then
      return false;
    end if;
  end loop;
  return true;
end;
$$;

comment on function public.mini_sudoku_solved(integer[]) is
  'Whether 36 Mini Sudoku cells are full and every row, column and 2×3 box holds 1 to 6 once each.';

revoke all on function public.mini_sudoku_solved(integer[]) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A move is `cell × 10 + digit`: it names a cell that did not start filled and
-- sets it to the digit, 0 clearing it. A cell that started filled, a cell off the
-- board, a digit above 6, or a move that leaves the cell as it was is impossible
-- play. Once no cell is empty and every unit holds 1 to 6 (`mini_sudoku_solved`),
-- the board scores sixty points and the next starts. A submission that stops with
-- the run live is the clock or the player ending it, and is valid: the score never
-- goes down.

create or replace function public.complete_mini_sudoku_run(
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
  v_result   public.play_result;
  v_session  public.game_sessions;
  v_game     public.games;
  v_user     uuid := auth.uid();
  v_level    int := 1;
  v_cells    int[];
  v_start    int[];
  v_empty    int;
  v_placed   int := 0;
  v_cleared  int := 0;
  v_score    bigint := 0;
  v_over     boolean := false;
  v_action   int;
  v_cell     int;
  v_digit    int;
  v_digest   text;
  v_elapsed  bigint;
  v_best     bigint;
  v_rank     bigint;
begin
  if p_session_id is null then
    raise exception 'a session id is required' using errcode = '22023';
  end if;
  if p_actions is null or array_position(p_actions, null) is not null then
    raise exception 'actions must be a dense array of moves' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 1 then
    raise exception 'duration must be a positive number of milliseconds' using errcode = '22023';
  end if;

  select * into v_session from public.game_sessions s where s.id = p_session_id for update;

  if not found
     or (v_session.user_id is not null and v_session.user_id is distinct from v_user)
     or (v_session.user_id is null and v_user is not null) then
    v_result.outcome := 'not_found';
    v_result.session_id := p_session_id;
    return v_result;
  end if;

  select * into v_game from public.games g where g.id = v_session.game_id;

  v_digest := md5(concat_ws('|',
    v_session.rules_version,
    v_session.seed::text,
    array_to_string(p_actions, ','),
    p_score::text
  ));

  if v_session.completed_at is not null then
    if v_session.verified_digest = v_digest then
      v_result.outcome       := 'duplicate';
      v_result.session_id    := v_session.id;
      v_result.game_slug     := v_game.slug;
      v_result.score         := v_session.verified_score;
      v_result.duration_ms   := p_duration_ms;
      v_result.ranked        := v_session.user_id is not null;
      v_result.recorded_at   := v_session.completed_at;
      if v_session.user_id is not null then
        select max(s.score) into v_best from public.scores s
         where s.game_id = v_session.game_id and s.user_id = v_session.user_id;
        select count(*) + 1 into v_rank from (
          select s.user_id, max(s.score) as best
            from public.scores s
           where s.game_id = v_session.game_id and s.user_id is not null
           group by s.user_id
        ) t where t.best > coalesce(v_best, 0) and t.user_id <> v_session.user_id;
        v_result.personal_best := v_best;
        v_result.board_rank    := v_rank;
      end if;
      return v_result;
    end if;

    v_result.outcome := 'closed';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_session.verified_score;
    return v_result;
  end if;

  if v_session.abandoned_at is not null then
    v_result.outcome := 'abandoned';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if now() >= v_session.expires_at then
    v_result.outcome := 'expired';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if v_session.rules_version is null
     or v_session.rules_version <> public.mini_sudoku_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.mini_sudoku_max_actions() then
    v_result.outcome := 'invalid_actions';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  v_elapsed := (extract(epoch from (now() - v_session.started_at)) * 1000)::bigint;
  if p_duration_ms > v_elapsed + 2000 then
    v_result.outcome := 'invalid_duration';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  -- ── The replay ───────────────────────────────────────────────────────────
  v_start := public.mini_sudoku_start(v_session.seed, v_level);
  v_empty := 36 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
  v_cells := v_start;

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    v_cell := v_action / 10;
    v_digit := v_action % 10;
    if v_over or v_action < 0 or v_cell > 35 or v_digit > 6
       or v_start[v_cell + 1] <> 0 or v_cells[v_cell + 1] = v_digit then
      v_result.outcome := 'invalid_actions';
      v_result.session_id := v_session.id;
      v_result.game_slug := v_game.slug;
      return v_result;
    end if;

    if v_cells[v_cell + 1] = 0 then
      v_empty := v_empty - 1;
    elsif v_digit = 0 then
      v_empty := v_empty + 1;
    end if;
    v_cells[v_cell + 1] := v_digit;
    v_placed := v_placed + 1;

    if v_empty = 0 and public.mini_sudoku_solved(v_cells) then
      v_cleared := v_cleared + 1;
      v_score := v_score + 60;
      v_level := v_level + 1;
      v_start := public.mini_sudoku_start(v_session.seed, v_level);
      v_empty := 36 - coalesce(array_length(array_remove(v_start, 0), 1), 0);
      v_cells := v_start;
    end if;

    if v_placed >= public.mini_sudoku_max_actions() then
      v_over := true;
    end if;
  end loop;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_score;
    return v_result;
  end if;

  -- The clock, by the server's own time. The session was issued when the player
  -- pressed Start, so the time since then is the run's: it may not exceed what
  -- the solved boards earned, plus the slack. The session stays open, so a
  -- submission that is refused here can never be swapped for a shorter one later
  -- that the clock would accept: it would arrive later still.
  if v_elapsed > public.mini_sudoku_budget_ms(v_cleared) + public.mini_sudoku_slack_ms() then
    v_result.outcome := 'out_of_time';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  update public.game_sessions s
     set completed_at    = now(),
         verified_score  = v_score,
         verified_digest = v_digest
   where s.id = v_session.id
  returning * into v_session;

  if v_session.user_id is not null then
    insert into public.scores (session_id, game_id, user_id, score, duration_ms)
    values (v_session.id, v_session.game_id, v_session.user_id, v_score, p_duration_ms);
  end if;

  v_result.outcome         := 'recorded';
  v_result.session_id      := v_session.id;
  v_result.game_slug       := v_game.slug;
  v_result.score           := v_score;
  v_result.cleared_columns := v_cleared;
  v_result.tiles_placed    := v_placed;
  v_result.duration_ms     := p_duration_ms;
  v_result.ranked          := v_session.user_id is not null;
  v_result.recorded_at     := v_session.completed_at;

  if v_session.user_id is not null then
    select max(s.score) into v_best from public.scores s
     where s.game_id = v_session.game_id and s.user_id = v_session.user_id;
    select count(*) + 1 into v_rank from (
      select s.user_id, max(s.score) as best
        from public.scores s
       where s.game_id = v_session.game_id and s.user_id is not null
       group by s.user_id
    ) t where t.best > coalesce(v_best, 0) and t.user_id <> v_session.user_id;
    v_result.personal_best := v_best;
    v_result.board_rank    := v_rank;
  end if;

  return v_result;
end;
$$;

comment on function public.complete_mini_sudoku_run(uuid, integer[], bigint, integer) is
  'Replays a Mini Sudoku run from the session''s seed and records the score the replay derives. The caller identity is the verified token.';

revoke all on function public.complete_mini_sudoku_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_mini_sudoku_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate: the same function as the migration that last defined it
-- (`20261123120000_tapered_clocks.sql`), plus the (`mini-sudoku`,
-- `mini-sudoku@1`) pair, its action ceiling and its twelve-hour session.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.start_game_session(
  p_game_slug     text,
  p_rules_version text,
  p_client        text
)
returns public.session_start
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empty   public.session_start;
  v_game    public.games;
  v_user    uuid := auth.uid();
  v_client  text := nullif(btrim(coalesce(p_client, '')), '');
  v_session public.game_sessions;
begin
  if p_game_slug is null or p_game_slug !~ '^[a-z0-9-]{2,48}$' then
    raise exception 'invalid game slug' using errcode = '22023';
  end if;
  if p_rules_version is null or p_rules_version !~ '^[a-z0-9-]{2,32}@[0-9]{1,4}$' then
    raise exception 'invalid rules version' using errcode = '22023';
  end if;
  if v_client is not null and char_length(v_client) > 40 then
    raise exception 'client is longer than 40 characters' using errcode = '22023';
  end if;

  select * into v_game
    from public.games g
   where g.slug = p_game_slug
     and g.status = 'published'
     and g.playable
     and g.runtime is not null;

  if not found then
    v_empty.outcome := 'not_playable';
    return v_empty;
  end if;

  -- The gate is a pair: each runtime plays the rules versions its verifier
  -- implements. Stack 10, Chain, Memory Flash, One Move, Color Merge and Don't
  -- Touch the Black have two each — the endless version new runs pin, and the
  -- legacy finite version a session opened before the endless migrations still
  -- holds. Zip, 8 Puzzle, Tango, Sudoku and Decant keep the versions from before
  -- the tapered clock too, for the same reason. 7 Second, Queens, Gridburst,
  -- Updraft and the crossword have one. Anything else is a version no verifier owns.
  if (v_game.runtime = 'stack-10'
      and p_rules_version in ('stack-10@1', public.stack10_rules_version()))
     or (v_game.runtime = 'chain'
         and p_rules_version in ('chain@1', public.chain_rules_version()))
     or (v_game.runtime = 'memory-flash'
         and p_rules_version in ('memory-flash@1', public.memory_flash_rules_version()))
     or (v_game.runtime = 'one-move'
         and p_rules_version in ('one-move@1', public.one_move_rules_version()))
     or (v_game.runtime = 'color-merge'
         and p_rules_version in ('color-merge@1', public.color_merge_rules_version()))
     or (v_game.runtime = 'dont-touch'
         and p_rules_version in ('dont-touch@1', public.dont_touch_rules_version()))
     or (v_game.runtime = 'seven-second' and p_rules_version = public.seven_second_rules_version())
     or (v_game.runtime = 'queens' and p_rules_version = public.queens_rules_version())
     or (v_game.runtime = 'zip' and p_rules_version in ('zip@1', public.zip_rules_version()))
     or (v_game.runtime = 'eight-puzzle'
         and p_rules_version in ('eight-puzzle@1', public.eight_puzzle_rules_version()))
     or (v_game.runtime = 'tango' and p_rules_version in ('tango@1', public.tango_rules_version()))
     or (v_game.runtime = 'sudoku'
         and p_rules_version in ('sudoku@1', 'sudoku@2', public.sudoku_rules_version()))
     or (v_game.runtime = 'crossword' and p_rules_version = public.crossword_rules_version())
     or (v_game.runtime = 'gridburst' and p_rules_version = public.gridburst_rules_version())
     or (v_game.runtime = 'updraft' and p_rules_version = public.updraft_rules_version())
     or (v_game.runtime = 'decant'
         and p_rules_version in ('decant@1', public.decant_rules_version()))
     or (v_game.runtime = 'mini-sudoku' and p_rules_version = public.mini_sudoku_rules_version()) then
    -- Allowed: issued below.
    null;
  else
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  if v_game.runtime in ('seven-second', 'crossword') and v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_game.id::text || ':' || v_user::text, 0)
    );

    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_game.id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = case v_game.runtime when 'crossword' then public.crossword_day()
                                           else public.seven_second_seed() end
    ) then
      v_empty.outcome := 'already_played';
      return v_empty;
    end if;
  end if;

  if v_user is not null then
    update public.game_sessions s
       set abandoned_at = now()
     where s.game_id = v_game.id
       and s.user_id = v_user
       and s.completed_at is null
       and s.abandoned_at is null;
  end if;

  if v_game.runtime = 'seven-second' then
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, public.seven_second_seed())
    returning * into v_session;
  elsif v_game.runtime = 'crossword' then
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, public.crossword_day())
    returning * into v_session;
  else
    -- An endless run is a marathon, so its session lives for twelve hours instead
    -- of the table's two. Every finite game keeps two hours.
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            case when p_rules_version in ('chain@2', 'color-merge@2', 'stack-10@2',
                                          'memory-flash@2', 'one-move@2', 'queens@1', 'zip@1',
                                          'eight-puzzle@1', 'tango@1', 'sudoku@1',
                                          'sudoku@2', 'gridburst@1', 'decant@1', 'zip@2',
                                          'eight-puzzle@2', 'tango@2', 'sudoku@3', 'decant@2',
                                          'mini-sudoku@1')
                 then now() + interval '12 hours'
                 else now() + interval '2 hours' end)
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  v_empty.tile_count    := case v_game.runtime
                             when 'stack-10' then
                               case when p_rules_version = 'stack-10@1'
                                    then public.stack10_tiles()
                                    else public.stack10_max_tiles()
                               end
                             when 'chain' then
                               case when p_rules_version = 'chain@1'
                                    then public.chain_taps()
                                    else public.chain_max_actions()
                               end
                             when 'memory-flash' then
                               case when p_rules_version = 'memory-flash@1'
                                    then public.memory_flash_taps()
                                    else public.memory_flash_max_taps()
                               end
                             when 'one-move' then
                               case when p_rules_version = 'one-move@1'
                                    then public.one_move_taps()
                                    else public.one_move_max_taps()
                               end
                             when 'color-merge' then
                               case when p_rules_version = 'color-merge@1'
                                    then public.color_merge_slides()
                                    else public.color_merge_max_slides()
                               end
                             when 'dont-touch' then
                               case when p_rules_version = 'dont-touch@1'
                                    then public.dont_touch_cells()
                                    else public.dont_touch_max_cells()
                               end
                             when 'seven-second' then public.seven_second_answers()
                             when 'queens' then public.queens_max_actions()
                             when 'zip' then public.zip_max_actions()
                             when 'eight-puzzle' then public.eight_puzzle_max_actions()
                             when 'tango' then public.tango_max_actions()
                             when 'sudoku' then public.sudoku_max_actions()
                             when 'crossword' then public.crossword_max_actions()
                             when 'gridburst' then public.gridburst_max_moves()
                             when 'updraft' then public.updraft_max_actions()
                             when 'decant' then public.decant_max_actions()
                             when 'mini-sudoku' then public.mini_sudoku_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@2 (and zip@1), 8 Puzzle accepts eight-puzzle@2 (and eight-puzzle@1), Tango accepts tango@2 (and tango@1), Sudoku accepts sudoku@3 (and sudoku@2 and sudoku@1), Gridburst accepts gridburst@1, Updraft accepts updraft@1 and Decant accepts decant@2 (and decant@1) — the @1 versions and sudoku@2 are the clocks before the taper; Mini Sudoku accepts mini-sudoku@1; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';
