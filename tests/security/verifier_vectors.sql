-- Game verifier vectors: the database must replay each game exactly as its
-- client engine does.
--
-- A verifier is a second copy of a game's rules, in SQL. If it drifts from the
-- engine in src/lib/games, real runs are refused as score_mismatch, so this file
-- pins the two together: every row below is what the engine computes, and the
-- database's own functions must reproduce it. src/test/verifier-vectors.test.ts
-- recomputes the same rows from the engines, so changing either side without the
-- other fails a test.
--
-- Run by scripts/test-rls.sh after the migrations, against a throwaway database
-- only. Everything runs in one transaction and rolls back.

\set ON_ERROR_STOP on

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'refusing to run: these vectors are for a throwaway database, not a hosted project';
  end if;
end $$;

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Cascade: a seed's first deal, then a line of swaps, each resolved and refilled
-- ─────────────────────────────────────────────────────────────────────────────

-- The board after the line, row by row, then the score: what complete_cascade_run
-- would derive, without a session around it.
create function pg_temp.cascade_line(p_seed bigint, p_actions integer[])
returns text language plpgsql as $$
declare
  b int[]; s bigint; a int; x int; y int; t int; tiles int; pts bigint; total bigint := 0; out text;
begin
  select f.p_board, f.p_state into b, s from public.cascade_first_board(p_seed) f;
  foreach a in array p_actions loop
    if not public.cascade_swap_legal(b, a) then
      return 'illegal swap ' || a;
    end if;
    x := a / 2;
    y := case when a % 2 = 0 then x + 1 else x + 8 end;
    t := b[x + 1]; b[x + 1] := b[y + 1]; b[y + 1] := t;
    select r.p_board, r.p_state, r.p_tiles, r.p_points into b, s, tiles, pts
      from public.cascade_resolve(b, s, x, y) r;
    if not public.cascade_has_swap(b) then
      select d.p_state, d.p_board into s, b from public.cascade_deal(s) d;
    end if;
    total := total + pts;
  end loop;
  select string_agg(array_to_string(b[r * 8 + 1 : r * 8 + 8], ''), ' ' order by r) into out
    from generate_series(0, 7) r;
  return out || ' | ' || total;
end $$;

do $$
declare
  v record;
  got text;
begin
  for v in select * from (values
    -- vectors:cascade:begin
    ('1', '0,6,16,21,25,44,49,4,52,75,40,24,5,21,4,5,0,8,41,38,4,9,41,53,36,2,12,20,28,38,0,5,3,6,17,34,19,3,43,48,23,19,4,23,39,19,18,5,51,4,36,56,54,11,13,42,29,11,26,15', 282, '14423616 64523352 13656223 43631312 46551124 53112334 12113251 26434112'),
    ('42', '5,5,4,13,11,12,18,5,6,28,28,36,20,20,4,4,24,4,4,5,22,5,5,7,5,32,33,19,33,1,1,10,8,19,39,0,7,1,18,16,49,57,34,39,54,7,4,25,33,4,43,10,8,48,18,53,59,79,13,13', 311, '26242566 54614352 62132542 41246166 46635132 329215511 44351241 25464422'),
    ('9001', '24,23,27,47,50,6,20,5,40,11,11,10,22,28,37,0,37,18,54,75,71,9,8,12,9,9,20,27,8,11,36,7,7,18,20,7,9,2,22,25,34,2,7,20,36,57,20,17,27,20,19,20,35,26,21,3,3,4,3,13', 331, '26542362 63563251 32125641 64113264 35626345 22512351 14231264 15624623')
    -- vectors:cascade:end
  ) as vectors(seed, actions, score, board) loop
    got := pg_temp.cascade_line(v.seed::bigint, string_to_array(v.actions, ',')::integer[]);
    if got is distinct from v.board || ' | ' || v.score then
      raise exception 'ASSERTION FAILED: Cascade seed % — the database gives %, the engine %',
        v.seed, got, v.board || ' | ' || v.score;
    end if;
    raise notice 'ok   Cascade seed %: the verifier replays the engine''s line', v.seed;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Checkmate: the puzzles a seed deals, as the answers the verifier expects
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  got text;
begin
  for v in select * from (values
    -- vectors:checkmate:begin
    ('1', '3222 | 334 | 4093 | 1726 | 578 | 2637 | 3828 3332 | 1242 904 | 2219 1256 | 1878 3844'),
    ('42', '2586 | 648 | 63 | 2866 | 2851 | 4071 | 3754 2733 | 2478 828 | 1893 2426 | 75 448'),
    ('9001', '1023 | 3381 | 2491 | 203 | 2113 | 1734 | 2909 1867 | 1357 837 | 2767 3974 | 1877 2124')
    -- vectors:checkmate:end
  ) as vectors(seed, answers) loop
    select string_agg(array_to_string(public.checkmate_answers(v.seed::bigint, l), ' '), ' | ' order by l)
      into got
      from generate_series(1, 10) l;
    if got is distinct from v.answers then
      raise exception 'ASSERTION FAILED: Checkmate seed % — the database gives %, the engine %',
        v.seed, got, v.answers;
    end if;
    raise notice 'ok   Checkmate seed %: the verifier deals the engine''s puzzles', v.seed;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Bolted: the nuts a seed deals a level, bolt by bolt and bottom first
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  got text;
begin
  for v in select * from (values
    -- vectors:bolted:begin
    ('1', '1', '213233211321'),
    ('1', '5', '53114212355353412442'),
    ('1', '13', '86857421254473678383114662132575'),
    ('42', '1', '113231221332'),
    ('42', '5', '21211224154353435345'),
    ('42', '13', '83165831178675672561428573224344'),
    ('9001', '1', '311313221223'),
    ('9001', '5', '23451315124314342525'),
    ('9001', '13', '77134742468258532568413217385616')
    -- vectors:bolted:end
  ) as vectors(seed, level, nuts) loop
    got := array_to_string(public.bolted_board(v.seed::bigint, v.level::integer), '');
    if got is distinct from v.nuts then
      raise exception 'ASSERTION FAILED: Bolted seed % board % — the database deals %, the engine %',
        v.seed, v.level, got, v.nuts;
    end if;
    raise notice 'ok   Bolted seed % board %: the verifier deals the engine''s board', v.seed, v.level;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fusebox: the cells a seed deals a level, one hex digit each (charge + 4 × kind)
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  got text;
begin
  for v in select * from (values
    -- vectors:fusebox-boards:begin
    ('1', '1', '022310021200332112130320102201102203'),
    ('1', '3', '321603131001122112003103233130112221'),
    ('1', '5', '590203112010010013221101302222010200'),
    ('1', '13', '20000905ab102122112112220a7592100102'),
    ('42', '1', '001030211232103301202110122112021221'),
    ('42', '3', '252001002201301012232010330101310022'),
    ('42', '5', '120107231010031000290303103120022200'),
    ('42', '13', '01295212b6120300001210a21131050212aa'),
    ('9001', '1', '120212220200111112223203100002111222'),
    ('9001', '3', '321002302201210322061322002122001010'),
    ('9001', '5', '022111101110122200225110122930332201'),
    ('9001', '13', '1932012100a1a01255a92050122213022111'),
    ('-7', '1', '002323222001201230020022200300033300'),
    ('-7', '3', '700102131202220110020301020231012200'),
    ('-7', '5', '100310232121112211211500120321119110'),
    ('-7', '13', '07101111220220311126a909322213005a91')
    -- vectors:fusebox-boards:end
  ) as vectors(seed, level, cells) loop
    select string_agg(to_hex(c), '') into got
      from unnest(public.fusebox_board(v.seed::bigint, v.level::integer)) as c;
    if got is distinct from v.cells then
      raise exception 'ASSERTION FAILED: Fusebox seed % board % — the database deals %, the engine %',
        v.seed, v.level, got, v.cells;
    end if;
    raise notice 'ok   Fusebox seed % board %: the verifier deals the engine''s board', v.seed, v.level;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fusebox: a line of taps, and everything the replay derives from it
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  r record;
  got text;
begin
  for v in select * from (values
    -- vectors:fusebox-lines:begin
    ('1', '13,8,16,10,14,8,7,15,27,22,23,17,26,1,7,8,3,12,16,4,17,22,26,5,3,24,18,19,26,20,27,8,23,28', '533', '0', '5', '4', '110', '510000220020020030000000000000030000'),
    ('42', '4,14,6,26,17,22,28,34,6,0,2,10,4,11,16,22,30,0,1,2,9,27,34,22', '188', '0', '3', '2', '64', '000002000002000032000000000002000003'),
    ('9001', '20,19,29,33,14,7,3,14,28,8,6,0,1,6,15,1,8,31,28,31,25,19,21,1,2,10,3,25,12,6,0,3,4,10,20,14,2,7,10,12,13,21,22,19,18', '493', '0', '7', '6', '157', '000000000000000000000000322220232030'),
    ('123456789', '2,0,1,7,6,14,20,34,35,17,0', '30', '0', '1', '0', '18', '100002000022000000000020020020000000'),
    ('-7', '27,6,22,9,6,0,34,0,6,12,19,15,3,16,15,1,25,3,7,8,14,16,12,19,20,4,11,17,24,31,15,32,25,19,17,23,13,5,23,27,26,25,5,0,0,0,0,0', '526', '0', '8', '7', '152', '322120221120160a02152921120122112122')
    -- vectors:fusebox-lines:end
  ) as vectors(seed, actions, score, sparks, level, boards, pops, cells) loop
    select * into r from public.fusebox_replay(
      v.seed::bigint, string_to_array(v.actions, ',')::integer[]);
    select string_agg(to_hex(c), '') into got from unnest(r.cells) as c;
    if not r.valid
       or r.score::text is distinct from v.score
       or r.sparks::text is distinct from v.sparks
       or r.level::text is distinct from v.level
       or r.boards::text is distinct from v.boards
       or r.pops::text is distinct from v.pops
       or got is distinct from v.cells then
      raise exception 'ASSERTION FAILED: Fusebox seed % — the database reaches % (score %, sparks %, board %, % cleared, % pops), the engine % (score %, sparks %, board %, % cleared, % pops)',
        v.seed, got, r.score, r.sparks, r.level, r.boards, r.pops,
        v.cells, v.score, v.sparks, v.level, v.boards, v.pops;
    end if;
    raise notice 'ok   Fusebox seed %: the verifier replays the engine''s line', v.seed;
  end loop;

  -- A tap off the board, or after the sparks ran out, is not a move.
  select * into r from public.fusebox_replay(1, array[36]);
  if r.valid then
    raise exception 'ASSERTION FAILED: Fusebox accepted a tap off the board';
  end if;
  select * into r from public.fusebox_replay(1, array[-1]);
  if r.valid then
    raise exception 'ASSERTION FAILED: Fusebox accepted a negative tap';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Minefield: the mines a seed deals a level, given the first cell opened
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  got text;
begin
  for v in select * from (values
    -- vectors:minefield-mines:begin
    ('1', '1', '27', '5,6,33,45,54,56,58,59'),
    ('1', '3', '0', '7,20,24,27,39,41,43,48,57,61,67'),
    ('1', '6', '55', '0,4,9,17,23,28,33,42,51,53,83,85,91,92,94'),
    ('1', '19', '99', '2,7,10,27,29,46,47,48,50,51,54,55,58,61,62,63,66,69,73,80,91,94'),
    ('42', '1', '27', '1,22,39,42,43,55,58,63'),
    ('42', '3', '0', '8,12,13,18,21,26,33,41,50,59,74'),
    ('42', '6', '55', '1,18,33,37,39,57,59,60,78,80,82,85,91,94,95'),
    ('42', '19', '99', '2,21,29,30,31,36,41,42,45,48,49,54,61,62,72,79,81,86,87,94,95,97'),
    ('9223372036854775807', '1', '27', '1,10,23,40,45,50,55,63'),
    ('9223372036854775807', '3', '0', '4,5,22,27,29,34,35,36,37,42,52'),
    ('9223372036854775807', '6', '55', '2,4,13,22,26,27,30,40,41,60,68,69,93,94,96'),
    ('9223372036854775807', '19', '99', '1,6,13,21,22,24,38,44,50,55,56,61,66,68,70,71,72,76,79,90,91,97'),
    ('-7', '1', '27', '4,23,24,38,40,43,46,60'),
    ('-7', '3', '0', '3,7,8,15,19,22,43,52,54,61,70'),
    ('-7', '6', '55', '21,22,24,25,27,31,33,34,37,43,49,50,52,78,82'),
    ('-7', '19', '99', '0,2,10,13,25,31,39,42,46,47,50,54,57,60,63,64,65,68,74,81,84,96')
    -- vectors:minefield-mines:end
  ) as vectors(seed, level, first, mines) loop
    select array_to_string(
      public.minefield_mines(v.seed::bigint, v.level::integer, v.first::integer), ',') into got;
    if got is distinct from v.mines then
      raise exception 'ASSERTION FAILED: Minefield seed % board % first % — the database deals %, the engine %',
        v.seed, v.level, v.first, got, v.mines;
    end if;
    raise notice 'ok   Minefield seed % board %: the verifier deals the engine''s mines', v.seed, v.level;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Minefield: a line of actions, and everything the replay derives from it. The cells
-- left are written one digit each: 0 closed, 1 flagged, 2 open, 3 a mine that was hit.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  r record;
  got text;
begin
  for v in select * from (values
    -- vectors:minefield-lines:begin
    ('1', '27,5,6,33', '43', '0', '1', '0', '43', '3', '2222233022222222222222222222222203222222002220220022200000000000'),
    ('1', '27,7,32,40,41,48,49,53,55,57,60,61,62,63', '80', '3', '2', '1', '56', '0', '0000000000000000000000000000000000000000000000000000000000000000'),
    ('42', '128,27,128,28', '51', '3', '1', '0', '51', '0', '0022222222222222222222002222222022222220220022202202222022022220'),
    ('7', '27,100,101,9', '48', '1', '1', '0', '48', '2', '1130000032222222222222220222222202222222022202220222222202222220'),
    ('124', '35,110,17,102,111,4,132,141,33,40,48,150,49,155,54,35,140,41,145,153,52,61,54,138,29,114,5,6,15,131,139,157,48,43,169,60,59,70,141,33,32,116,15,7,104,13,130,31,148,39,29,47,58,111,1,165,177,67,174,72,63,43,141,33,50,49,126,25,167,58,68,175,66,147,48,9,105,14,107,16,131,146,36,45,56,163,173,64', '345', '3', '5', '4', '252', '1', '000000000000000000000000000000000000000000000000000000000000000000000000000000000'),
    ('186', '35,125,26,18,112,3,4,5,120,13,123,132,140,33,24,108,1,153,52,35,13,31,120,11,117,8,16,121,133,24,141,32,147,46,54,152,43,51,149,40,48,43,139,30,29,38,111,1,149,48,154,155,159,168,66,56,57,64,175,76,67,77,179,70,43,7,66,137,154,46,36,27,122,13,130,21,159,49,132,33,115,5,6,126,25,108,170,61,69,71', '336', '1', '5', '4', '252', '3', '000000000000000000000000000000000000000000000000000000000000000000000000000000000'),
    ('-2', '35,106,114,22,15,118,147,150,42,43,153,52,154,46,55,35,14,37,9,54,23,15,129,28,113,6,5,4,118,140,152,43,51,149,41,48,43,123,124,32,125,34,149,145,46,36,121,20,139,179,180,16', '214', '0', '3', '2', '174', '3', '222200000222200030222121112222222222222122222122212222222222222222222222222222211')
    -- vectors:minefield-lines:end
  ) as vectors(seed, actions, score, lives, level, boards, opened, hits, cells) loop
    select * into r from public.minefield_replay(
      v.seed::bigint, string_to_array(v.actions, ',')::integer[]);
    select array_to_string(r.cells, '') into got;
    if not r.valid
       or r.score::text is distinct from v.score
       or r.lives::text is distinct from v.lives
       or r.level::text is distinct from v.level
       or r.boards::text is distinct from v.boards
       or r.opened::text is distinct from v.opened
       or r.hits::text is distinct from v.hits
       or got is distinct from v.cells then
      raise exception 'ASSERTION FAILED: Minefield seed % — the database reaches % (score %, lives %, board %, % cleared, % opened, % hit), the engine % (score %, lives %, board %, % cleared, % opened, % hit)',
        v.seed, got, r.score, r.lives, r.level, r.boards, r.opened, r.hits,
        v.cells, v.score, v.lives, v.level, v.boards, v.opened, v.hits;
    end if;
    raise notice 'ok   Minefield seed %: the verifier replays the engine''s line', v.seed;
  end loop;

  -- Each of these is not a move, on a board where cell 27 opens a clear area.
  foreach got in array array['{64}', '{164}', '{-1}', '{27,27}', '{127,27}', '{27,127}', '{27,5,6,33,0}', '{27,5,6,33,100}'] loop
    select * into r from public.minefield_replay(1, got::integer[]);
    if r.valid then
      raise exception 'ASSERTION FAILED: Minefield accepted %', got;
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Crowns (queens@2): a line of taps, undos (81) and clears (82). The cells left are
-- written one digit each: 0 empty, 1 X, 2 crown.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
  r record;
begin
  for v in select * from (values
    -- vectors:queens-speed:begin
    ('1', '0,0,0,3,3,81,81,82,1,1,8,8,10,10,19,19,22,22,4', '50', '2', '1', '000010000000000000000000000000000000'),
    ('1', '1,1,3,81,1', '0', '1', '0', '0000000000000000000000000'),
    ('1', '0,0,1,1,81,81,81', '0', '1', '0', '1000000000000000000000000'),
    ('1', '1,1,8,8,10,10,19,19,0,0,0,22,22', '50', '2', '1', '000000000000000000000000000000000000')
    -- vectors:queens-speed:end
  ) as vectors(seed, actions, score, level, cleared, cells) loop
    select * into r from public.queens_speed_replay(
      v.seed::bigint, string_to_array(v.actions, ',')::integer[]);
    if not r.valid
       or r.score::text is distinct from v.score
       or r.level::text is distinct from v.level
       or r.cleared::text is distinct from v.cleared
       or array_to_string(r.cells, '') is distinct from v.cells then
      raise exception 'ASSERTION FAILED: Crowns line % — the database reaches % (score %, board %), the engine % (score %, board %)',
        v.actions, array_to_string(r.cells, ''), r.score, r.level, v.cells, v.score, v.level;
    end if;
    raise notice 'ok   Crowns line %: the verifier replays the engine''s line', v.actions;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The speed bonus: points, par, elapsed, bonus
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v record;
begin
  for v in select * from (values
    -- vectors:speed-bonus:begin
    ('50', '60000', '0', '50'),
    ('50', '60000', '30000', '25'),
    ('50', '60000', '59999', '0'),
    ('50', '60000', '60000', '0'),
    ('50', '60000', '999999', '0'),
    ('110', '150000', '30000', '88'),
    ('0', '60000', '0', '0'),
    ('50', '0', '0', '0')
    -- vectors:speed-bonus:end
  ) as vectors(base, par, elapsed, bonus) loop
    if public.speed_bonus(v.base::bigint, v.par::bigint, v.elapsed::bigint)::text is distinct from v.bonus then
      raise exception 'ASSERTION FAILED: speed_bonus(%, %, %) is not %', v.base, v.par, v.elapsed, v.bonus;
    end if;
  end loop;
end $$;

rollback;
