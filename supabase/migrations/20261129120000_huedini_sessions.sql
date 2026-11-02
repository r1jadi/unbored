-- Huedini (`huedini@1`): coloured blocks that slide out through gates of their
-- own colour, verified by the database.
--
-- A block slides until a wall, another block or the edge stops it; at the edge it
-- leaves through a gate of its colour that covers its whole width. Boards come
-- from a bank a solver proved clearable (`scripts/generate-huedini-bank.mjs`), in
-- four tiers, with their colours relabelled by the seed. A run is a series of
-- boards against one tapered clock (`clock_taper_pct`), like Decant's.
--
-- This migration is half the feature:
--
--   1. The rules, as constants the database owns; the bank and the boards
--      (`huedini_board`), mirrored by src/lib/games/huedini.ts.
--   2. `public.complete_huedini_run`, the verifier: it replays the moves, undos
--      and restarts from the session's seed and derives the score itself.
--   3. `public.start_game_session` learns the (`huedini`, `huedini@1`) pair.
--
-- Nothing here puts Huedini in the catalogue: `20261129120100_huedini_playable.sql`
-- does, after the deployment carrying the runtime is live. See docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules, as constants the database owns
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.huedini_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'huedini@1'::text $$;

create or replace function public.huedini_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 8192 $$;

create or replace function public.huedini_slack_ms()
returns integer language sql immutable set search_path = '' as $$ select 20000 $$;

-- The bank tier a level draws from: boards 1–2, 3–5, 6–9, then the rest.
create or replace function public.huedini_tier(p_level integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_level is null or p_level < 1 then
    raise exception 'a Huedini level is one or more' using errcode = '22023';
  end if;
  return case when p_level <= 2 then 0 when p_level <= 5 then 1 when p_level <= 9 then 2 else 3 end;
end;
$$;

-- The time a board of a tier is given, before the taper.
create or replace function public.huedini_allowance_ms(p_tier integer)
returns bigint language sql immutable set search_path = '' as $$
  select case p_tier when 0 then 30000 when 1 then 40000 when 2 then 50000 else 60000 end::bigint
$$;

-- The clock a run has earned with `p_cleared` boards cleared: 75 s, plus, for
-- every cleared board, the allowance of the board after it, tapered by the board
-- just cleared.
create or replace function public.huedini_budget_ms(p_cleared integer)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_total bigint := 75000;
  v_level integer;
begin
  for v_level in 1..greatest(coalesce(p_cleared, 0), 0) loop
    v_total := v_total
             + public.huedini_allowance_ms(public.huedini_tier(v_level + 1))
               * public.clock_taper_pct(v_level) / 100;
  end loop;
  return v_total;
end;
$$;

comment on function public.huedini_rules_version() is
  'The Huedini rules version the database can verify. A rules change needs a new version and a new verifier.';
comment on function public.huedini_max_actions() is
  'The most actions a Huedini submission may carry. A request bound, not a final board.';
comment on function public.huedini_slack_ms() is
  'How long after its clock ran out a Huedini run is still accepted.';
comment on function public.huedini_tier(integer) is
  'The bank tier a Huedini level draws from: boards 1–2 gentle (0), 3–5 easy (1), 6–9 tricky (2), then hard (3).';
comment on function public.huedini_allowance_ms(integer) is
  'The time a Huedini board of each tier is given before the taper: 30, 40, 50 and 60 s.';
comment on function public.huedini_budget_ms(integer) is
  'The clock a huedini@1 run has earned: 75 s plus the next board''s allowance for every cleared board, tapered by clock_taper_pct.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The bank: four tiers of 40 boards, each proved clearable
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `side|cells|colours|gates`, as scripts/generate-huedini-bank.mjs writes them:
-- cells row by row (`.` empty, `#` wall, a letter per block), one colour digit
-- per block in letter order, and three digits per gate: edge (0 top, 1 right,
-- 2 bottom, 3 left), its first cell along that edge, and its colour.
create or replace function public.huedini_bank()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    -- bank:begin
    -- gentle
    '5|.....a.bb.a.c....c.......|132|001103202',
    '5|.....a.#..a..b....b..c...|132|133212311',
    '5|.aa...#.........b.cc.b...|231|012131223',
    '5|.aa.....bb.#...........c.|312|101232313',
    '5|.........a.b....b.cc.....|132|101132333',
    '5|...a....b..cc#...........|213|032101133',
    '5|.....a....a.b....b.c.....|123|022123331',
    '5|......aa...b#...b.c......|321|002033131',
    '5|...a..bb.........cc......|231|013032201',
    '5|........a..b#a.cb.ddc....|3122|202233321',
    '5|a.b..a.b.....cc..#..dd...|3112|003111332',
    '5|...a...ba..c......d....d.|3221|012133231',
    '5|aa......#..b.c..b.cd....d|3112|033232321',
    '5|..a...ba...b.....c....c..|123|013202221',
    '5|.....a....a...b..c.b..cd.|1312|123201232',
    '5|.a........b..cdb..cd.....|3231|003031202',
    '5|.a.....#..bbcc........dd.|2133|121223312',
    '5|......aa.b.......cc......|231|201303322',
    '5|..aa..b.#c.b......d....d.|2313|022101223',
    '5|....a..b.ac.b..c.d.......|1232|021212323',
    '5|........aa...#...bb...cc.|213|001102233',
    '5|...aa...#..b....bc.d.....|1321|003101332',
    '5|.......aa.bcc..b.....dd..|3312|121212303',
    '5|...a...b#...bc.........d.|1322|021232303',
    '5|....a....a.#....bb.c....c|213|031102303',
    '5|.aa....bb.cd#..cd........|1323|031103322',
    '5|.a....a..b..c.b..d....d..|2311|022103221',
    '5|.a....a....bb...c....c...|213|003101312',
    '5|.aa..b....b#....c.d..c...|3312|001122313',
    '5|...a.b..a.b#..c..d.c..d..|1223|031223332',
    '5|...aa..bb.cc.d....d......|3213|033101202',
    '5|..aa...b....b...cc...d...|2311|032131233',
    '5|......a.bb........ccdd...|1231|112201223',
    '5|..a....a.b.#..b......cdd.|2123|022111223',
    '5|..aa......b.#...c.d..c...|2133|122213321',
    '5|......a.b..a.b..ccdd.....|2313|133201302',
    '5|..a.b.#a........cc.d....d|1123|031113202',
    '5|..aa..b#...b..c....c..dd.|1223|021123332',
    '5|..a....a.bcc#.b.d....d...|3321|003312331',
    '5|aa........bb...cc.dd.....|2133|021123302',
    -- easy
    '6|.a.....a.#bb.......cdd#..e.....e....|43211|002103304331',
    '6|........a.b.c.a.b.c#.d...e.....e....|24321|032201234303',
    '6|.a.b...a.b..cc##.........dd.....ee..|44213|014121223322',
    '6|........a.b.ccd.b...d.....#....ee...|12443|102121213324',
    '6|.aa.......#....bb........#cdee...d..|21341|012223241304',
    '6|.aa..........b.#.c.....cdd.......e..|32214|013142224341',
    '6|...a...b.a.c.b..#c..dd..........ee..|31421|033114221342',
    '6|...a...bb.#........#.ccd...e.d......|13241|002021134313',
    '6|......a.bbcc..............#.d...ee..|13342|111134222323',
    '6|..a.....#...bb.c.....c.d.#.........e|42321|014141243332',
    '6|...a.b...#.........c..ddee..#.......|41223|111132324343',
    '6|.a..b.ca#...c...d..#..d.......ee....|23411|012233324341',
    '6|.a.....a...b...#.b.cc...dde#....e...|13422|001113204332',
    '6|.aa.......b...#....cc.....d.e...d.e.|34124|043221244342',
    '6|....a..bb.a.......c.d##.c...e.....e.|21432|001042123334',
    '6|.aa......bb..........c.dee#c........|22134|012031133344',
    '6|..ab...#.c.....c....dd......#...ee..|21343|002021124243',
    '6|...aa.bb.#.....#cc......dd......ee..|32124|043101224332',
    '6|.aa..........#.b.c...b..d#.......e..|41321|024113231342',
    '6|......a..b...#c.....c...d#.e.....e..|22314|004143302341',
    '6|aa......b.....b....c..#..c.d.....dee|12443|102214233301',
    '6|.a.....a.....#bcc.d#b...d...ee......|21341|012043141304',
    '6|.a......#...bc....b.d.....d.ee......|31424|011044222323',
    '6|aa.b.....b.c.##d...........e........|21433|044121312343',
    '6|...aa..bb......c.......d..##.d..ee..|23214|003032131334',
    '6|.a.....a.bb.....cd.#..cd....e.......|32114|103121202304',
    '6|...a..bb..c...#.c....de.............|13342|001103204302',
    '6|.aa....b.....#...c.....c..dd...e....|44213|004031122203',
    '6|.aa.........b.c.ddb.cee....##.......|34221|013122224311',
    '6|.......abbcc.a.......#....#.dd..ee..|43214|013132231344',
    '6|.aa.bb.......c..d.....d..#.#...ee...|42312|041133314342',
    '6|.......a..b....cb....c...d.#ee.d....|32241|102204233341',
    '6|aa............b#.c.db..c.d.ee.......|21234|133241302324',
    '6|..aa.......b....#......c.d.eec......|31241|121212323344',
    '6|a.......bbcc...#...dd......ee.......|32413|021114242303',
    '6|......a.b...a.bc.d...c......#....ee.|13142|003144242301',
    '6|.....ab.#..ab.....cc.#......d..ee.d.|24431|023042241314',
    '6|.aa.....bbc.....c...#.d....e#....e..|21234|012041233304',
    '6|...aa.....#.b#.ccdb....d...ee.......|32241|022043124321',
    '6|.......#a...b.a.cc........dd.e......|14243|002133231314',
    -- tricky
    '6|......a.b.#.a#b.cc.#..ccd...e...f...|231441|033131312344',
    '6|.......a.bcc.a#....#.deef..d#.f.....|233142|103124201342',
    '6|a..bb.a..bb........cdd#..c..ee...ff.|231241|033214322341',
    '6|...a...#.bb....bbcd.e##.d.e.......f.|313442|021214232323',
    '6|..aa...b....cbd.eec#d.ff...#ff......|421413|143222304321',
    '6|.....a..b#ca.#b.c....#.....ddeff.dde|424132|044123231332',
    '6|aa.bb....bb..#c...ddc.ee...#...ff...|113234|003214301332',
    '6|aa.bb...#.#........cc#de.cc..e...ff.|243111|012044231343',
    '6|....aa.bb.....#...ccd...ccdee..f....|334132|043212231324',
    '6|...aa.b.caadb.c......ee.ff..#.ff....|232241|011034102303',
    '6|......aa.b..aa.b#..c.....d.##..e..f.|422331|014231312333',
    '6|.aabbc.aa..c..dd...#.....#..ee.ff.ee|133324|023142311344',
    '6|...aa.bb#...bb#.c.d.....d..e#.....f.|412342|034103242301',
    '6|....aa.bb...cc...d....ed.#ffe...ff..|311442|123144222321',
    '6|..aa..b#......cc#.ddcce...#....ff...|242131|022223304321',
    '6|...aa...#.bbc...bb.....d.#ee#d..eeff|424231|112223241314',
    '6|..aa...bb#cc.bb....#....d..e..ff.e..|131422|101122303334',
    '6|...aa..b........#.....cc.d.ee....ff.|334122|001134223342',
    '6|..a....ba....bcc.de.#..de##.f.......|242313|012233324341',
    '6|.a.bb.......cc.##.cc.d.....eef...eef|241323|011044202243',
    '6|a..bb.a..cc...#...d.ee..d.ee.f......|444312|124142211333',
    '6|.....a.#bb.a.....cd...efd..#ef......|412123|014032143331',
    '6|.aa.bb.c.....c.#..dd..eedd##.....ff.|312234|041103234322',
    '6|.aa...b#.#..b.cd...#cd..e.ff..e.....|314222|123234311342',
    '6|.......a...bca.debc..#e...ff....ff..|313342|031134202323',
    '6|...a...b.a.c.b..#cd.....d#.ef.......|223431|022123211334',
    '6|...aa...#.......b.c#....c.d.ef....e.|311241|033102141214',
    '6|...aa...bb...cc....dd.#e.....e..ff..|423421|042104231303',
    '6|...a.b...a.b..##...#..ccd.e.cc.fe...|224133|012134213331',
    '6|....aa..#....bb.#...#....cdee...d.ff|113243|124143232331',
    '6|....abc.#.abc...dd...ee..f.ee.......|424134|003024042321',
    '6|.aa....#.bb.c.d.......#.ee#...ee..f.|322414|013134201312',
    '6|..aa..bcdd#.bc#......ee..#.ff.......|341142|023212301334',
    '6|..aa...#aabc....d..ef....ef.#.......|124133|132203224331',
    '6|.....ab#...a.c.....cdd...#.ee..ff...|134112|014041132313',
    '6|.a.....b.#c..d..c..d.....#.#.e.ff..e|333124|033132214301',
    '6|.a.....a.b...#..c..d.#...e.#ff.e....|421333|122213301324',
    '6|........a....bbc..d.#ce.dff.e..ff...|224313|042121144233',
    '6|.a......#....b#....b.c.dee.c#d...f..|121432|001023134302',
    '6|..aab.ccaab.........#.d..ee.d..ff...|132411|014201223322',
    -- hard
    '7|........#.aa.b.....#b.cc.......d....eed.fg.....f.|1431532|104122141215253',
    '7|..a....bba.cc....##....dd......e#f..gge.f..gg....|3421525|023211252314355',
    '7|.....a.b..cdd..........#.e..ff..eggff#..gg.......|3115424|005113134301322',
    '7|.a...b..a.ccb.d..cc..d....#...#..ee.#ffgee.......|3431552|003124155252321',
    '7|...a...b##...c...d..c.....#..e.ff.....ffg......g.|1342151|022051114303325',
    '7|.........a.#bc......cd.e......e..#f.........gg...|2524153|001112145223334',
    '7|........aa.bb..aa....c...##.c.d......d..ee..ffgg.|5422131|141205233304332',
    '7|...a.bb.c#a.#..c..#.....dd...e..ff..e.........g..|2553341|004032223241305',
    '7|....a...#b.acc..b..............#.#de..ff.d....gg.|3321455|014053102131245',
    '7|.....a.bb##.a.bb.c.dd.....dd..ee...ff.......g....|5243514|043145214302341',
    '7|....a.b.cd.a.b..d.....e...#f.e#.g.f.....#.....hh.|45431322|034055103152211',
    '7|.aa.....aa..#..b....c.b.dd...ee..f..gg#.f..gghh..|43412525|124202255323341',
    '7|.......ab.....ab.c#.d...c..dee..f.....#fgg.....gg|4542133|015112253304331',
    '7|.a.........bc..#..bd.e....d.e#f.g......g#........|4542341|014035302323351',
    '7|aa...b...cc.b.d#.....d.......#.#.ef.....ef..gg...|4351352|024053145222321',
    '7|a.bb...a.........c.#..dec.....e#.#.f.gg...f......|4351512|043201252305354',
    '7|....aa.b.#.aacb...#dd....eddff.#e......gg..h.....|12455353|114155251312333',
    '7|.a..bbc.#..bbc........d...#..ee#....eef.gg.......|4514233|004115131223332',
    '7|.a.bb...a...cd....#cd.e..#...e...#f......f.gg....|1432153|001102125213244',
    '7|aa.bb...cc..d..cc..#.e.#ff..e.....g...#......h...|41415132|005111232304323',
    '7|.......ab..cc..b..##......dde....dd...ff...g.....|4223415|004032121205323',
    '7|...aa...bb.#...bb.........c..d..e....#.e#..ff.gg.|4341525|034133212255301',
    '7|....aa.bb#.aacbb..ddc............#..ee.#f....g.f.|1314512|101134222245333',
    '7|.......a#bbcdea...cde..#........fgg..#.f.........|3125541|012035131224313',
    '7|ab.......c#d..eec.d.fee.....g....#h.....#h.......|54533112|004041142223305',
    '7|.aa...........b.c.dd.b#c.#...e....f.e.gghf...gg..|13455125|014035101242323',
    '7|.........##aab.c....b.cdd.#...dd.ee.ff.gee....g..|2542413|002103135154211',
    '7|.aa........#...b..........#.cd#ee..c..f.g....f.g.|3441152|102203235311344',
    '7|........a....b.a....b.c#.....#.dde...ff.eg.hh...g|42512134|015033112204221',
    '7|.aa..b....#..cd.ee.#c.........f..#......g...hh.g.|14523153|011044105253312',
    '7|.......aa.b......b.#.cc..d......d.efgg.##....hh..|23144153|012134235253321',
    '7|...abb.cc#a...........dee.#..df.#....f...g.......|2353314|015154303322351',
    '7|..aa...b.#...cb..#..c.......defgg..de.gg.h......h|54214133|025112221253334',
    '7|a....bba..#......ccdd...e#ddff.e..gffh...g..h....|54213325|041104142233255',
    '7|.........aa.#b......b.c.d.ee.c#....ffgg..hff.....|41234522|111143205252344',
    '7|..........aa#b...cc.b.#.cc..d#..ee.d..ff.....g...|4413512|054131205242343',
    '7|...a......a.....bb.#cd#....c.#.e.f....e.f...gg...|4352331|012125153201334',
    '7|aa.......#....bb..cc..dd.cc...#.....e..f.g.e....g|1515342|044122231305323',
    '7|aab.cc...dd...e.dd...e..#.....#....ff#.gg..h.....|23513344|015122204251343',
    '7|...aa....baa.c....ddc.......e.ff#..e#ff#gh.......|23114253|032151205243354'
    -- bank:end
  ]::text[]
$$;

comment on function public.huedini_bank() is
  'The huedini@1 puzzle bank: four tiers of 40 boards a solver proved clearable (gentle, easy, tricky, hard). Mirrored by src/lib/games/huedini-bank.ts.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A board: a bank entry, relabelled
-- ─────────────────────────────────────────────────────────────────────────────
--
-- One Move's outer LCG advanced once per level, and a second LCG started at that
-- state, as Decant draws its boards; a draw is the state's top sixteen bits. The
-- first draw picks the entry in the level's tier; then the colours 1–6 are
-- shuffled by a Fisher–Yates pass from the last down, each swap partner the next
-- draw modulo the colours left, and colour k becomes the shuffle's kth.
--
-- Returned flat: side, then the wall count and walls (cells), then the gate count
-- and (edge, start, colour) per gate, then the block count and (row, column,
-- height, width, colour) per block, blocks in letter order.
create or replace function public.huedini_board(p_seed bigint, p_level integer)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_state   bigint;
  v_current integer;
  v_code    text;
  v_parts   text[];
  v_side    integer;
  v_cells   text;
  v_colours text;
  v_gates   text;
  v_palette integer[] := array[1, 2, 3, 4, 5, 6];
  v_i       integer;
  v_j       integer;
  v_swap    integer;
  v_walls   integer[] := array[]::integer[];
  v_blocks  integer[] := array[]::integer[];
  v_seen    boolean[] := array_fill(false, array[26]);
  v_out     integer[];
  v_ch      text;
  v_id      integer;
  v_w       integer;
  v_h       integer;
  v_count   integer := 0;
begin
  if p_seed is null then
    raise exception 'a seed is required' using errcode = '22023';
  end if;
  if p_level is null or p_level < 1 or p_level > 8192 then
    raise exception 'huedini level is outside the reachable run' using errcode = '22023';
  end if;
  v_state := (p_seed % 4294967296 + 4294967296) % 4294967296;
  if v_state = 0 then
    v_state := 2654435769; -- 0x9E3779B9: a zero state would make the sequence degenerate
  end if;
  for v_current in 1..p_level loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
  end loop;

  v_state := (v_state * 22695477 + 1) % 4294967296;
  v_code := (public.huedini_bank())[public.huedini_tier(p_level) * 40 + ((v_state >> 16) % 40)::integer + 1];
  for v_i in reverse 5..1 loop
    v_state := (v_state * 22695477 + 1) % 4294967296;
    v_j := ((v_state >> 16) % (v_i + 1))::integer;
    v_swap := v_palette[v_i + 1];
    v_palette[v_i + 1] := v_palette[v_j + 1];
    v_palette[v_j + 1] := v_swap;
  end loop;

  v_parts := string_to_array(v_code, '|');
  v_side := v_parts[1]::integer;
  v_cells := v_parts[2];
  v_colours := v_parts[3];
  v_gates := v_parts[4];

  for v_i in 0..length(v_cells) - 1 loop
    v_ch := substr(v_cells, v_i + 1, 1);
    if v_ch = '#' then
      v_walls := v_walls || v_i;
    elsif v_ch between 'a' and 'z' then
      v_id := ascii(v_ch) - 97;
      if not v_seen[v_id + 1] then
        -- The first cell of a letter in reading order is its top-left.
        v_seen[v_id + 1] := true;
        v_w := 1;
        while v_i % v_side + v_w < v_side and substr(v_cells, v_i + v_w + 1, 1) = v_ch loop
          v_w := v_w + 1;
        end loop;
        v_h := 1;
        while v_i + v_h * v_side < length(v_cells)
              and substr(v_cells, v_i + v_h * v_side + 1, 1) = v_ch loop
          v_h := v_h + 1;
        end loop;
        v_blocks[v_id * 5 + 1] := v_i / v_side;
        v_blocks[v_id * 5 + 2] := v_i % v_side;
        v_blocks[v_id * 5 + 3] := v_h;
        v_blocks[v_id * 5 + 4] := v_w;
        v_blocks[v_id * 5 + 5] := v_palette[substr(v_colours, v_id + 1, 1)::integer];
        v_count := v_count + 1;
      end if;
    end if;
  end loop;

  v_out := array[v_side, coalesce(array_length(v_walls, 1), 0)] || v_walls
        || array[length(v_gates) / 3];
  for v_i in 0..length(v_gates) / 3 - 1 loop
    v_out := v_out || array[
      substr(v_gates, v_i * 3 + 1, 1)::integer,
      substr(v_gates, v_i * 3 + 2, 1)::integer,
      v_palette[substr(v_gates, v_i * 3 + 3, 1)::integer]
    ];
  end loop;
  return v_out || v_count || v_blocks;
end;
$$;

comment on function public.huedini_board(bigint, integer) is
  'The board a Huedini level is dealt, flat: side; walls; gates as (edge, start, colour); blocks as (row, column, height, width, colour). Mirrored by src/lib/games/huedini.ts.';

-- One slide of block `p_id` (0-based) in direction `p_dir` (0 up, 1 right,
-- 2 down, 3 left). `p_blocks` holds (row, column, height, width, colour, on the
-- board) per block; `p_gates` (edge, start, colour) per gate. Returns
-- (0, -, -) when it cannot move, (1, row, column) where it stops, or (2, -, -)
-- when it leaves through a gate of its colour that covers its whole width.
create or replace function public.huedini_slide(
  p_side integer, p_walls integer[], p_gates integer[], p_blocks integer[], p_id integer, p_dir integer
)
returns integer[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_grid  integer[] := array_fill(0, array[p_side * p_side]);
  v_b     integer;
  v_y     integer;
  v_x     integer;
  v_r     integer := p_blocks[p_id * 6 + 1];
  v_c     integer := p_blocks[p_id * 6 + 2];
  v_h     integer := p_blocks[p_id * 6 + 3];
  v_w     integer := p_blocks[p_id * 6 + 4];
  v_col   integer := p_blocks[p_id * 6 + 5];
  v_dr    integer := case p_dir when 0 then -1 when 2 then 1 else 0 end;
  v_dc    integer := case p_dir when 1 then 1 when 3 then -1 else 0 end;
  v_nr    integer;
  v_nc    integer;
  v_lo    integer;
  v_hi    integer;
  v_free  boolean;
  v_moved boolean := false;
  v_g     integer;
begin
  foreach v_b in array coalesce(p_walls, array[]::integer[]) loop
    v_grid[v_b + 1] := 1;
  end loop;
  for v_b in 0..coalesce(array_length(p_blocks, 1), 0) / 6 - 1 loop
    continue when v_b = p_id or p_blocks[v_b * 6 + 6] = 0;
    for v_y in 0..p_blocks[v_b * 6 + 3] - 1 loop
      for v_x in 0..p_blocks[v_b * 6 + 4] - 1 loop
        v_grid[(p_blocks[v_b * 6 + 1] + v_y) * p_side + p_blocks[v_b * 6 + 2] + v_x + 1] := 1;
      end loop;
    end loop;
  end loop;

  loop
    v_nr := v_r + v_dr;
    v_nc := v_c + v_dc;
    if v_nr < 0 or v_nc < 0 or v_nr + v_h > p_side or v_nc + v_w > p_side then
      v_lo := case when p_dir in (0, 2) then v_c else v_r end;
      v_hi := v_lo + case when p_dir in (0, 2) then v_w else v_h end - 1;
      for v_g in 0..coalesce(array_length(p_gates, 1), 0) / 3 - 1 loop
        if p_gates[v_g * 3 + 1] = p_dir and p_gates[v_g * 3 + 3] = v_col
           and p_gates[v_g * 3 + 2] <= v_lo and v_hi <= p_gates[v_g * 3 + 2] + 1 then
          return array[2, 0, 0];
        end if;
      end loop;
      exit;
    end if;
    v_free := true;
    for v_y in 0..v_h - 1 loop
      for v_x in 0..v_w - 1 loop
        if v_grid[(v_nr + v_y) * p_side + v_nc + v_x + 1] <> 0 then
          v_free := false;
        end if;
      end loop;
    end loop;
    exit when not v_free;
    v_r := v_nr;
    v_c := v_nc;
    v_moved := true;
  end loop;
  if not v_moved then
    return array[0, 0, 0];
  end if;
  return array[1, v_r, v_c];
end;
$$;

comment on function public.huedini_slide(integer, integer[], integer[], integer[], integer, integer) is
  'One Huedini slide: where a block stops, or whether it leaves through a gate of its colour. Mirrored by slide in src/lib/games/huedini.ts.';

revoke all on function public.huedini_board(bigint, integer) from public;
revoke all on function public.huedini_slide(integer, integer[], integer[], integer[], integer, integer) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a run: replay, verify, then record
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.complete_huedini_run(
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
  v_level    integer := 1;
  v_flat     integer[];
  v_side     integer;
  v_walls    integer[];
  v_gates    integer[];
  -- Six slots a block: row, column, height, width, colour, on the board (1/0).
  v_blocks   integer[];
  v_dealt    integer;
  v_history  integer[] := array[]::integer[];
  v_moves    integer := 0;
  v_action   integer;
  v_anchor   integer;
  v_dir      integer;
  v_id       integer;
  v_b        integer;
  v_slide    integer[];
  v_left     integer;
  v_total    integer := 0;
  v_placed   integer := 0;
  v_score    bigint := 0;
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

  if v_session.rules_version is distinct from public.huedini_rules_version() then
    v_result.outcome := 'wrong_rules';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if coalesce(array_length(p_actions, 1), 0) > public.huedini_max_actions() then
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
  -- Unpacks `huedini_board` into the side, walls, gates and blocks.
  v_flat := public.huedini_board(v_session.seed, v_level);
  v_side := v_flat[1];
  v_walls := v_flat[3 : 2 + v_flat[2]];
  v_b := 3 + v_flat[2];
  v_gates := v_flat[v_b + 1 : v_b + 3 * v_flat[v_b]];
  v_b := v_b + 1 + 3 * v_flat[v_b];
  v_dealt := v_flat[v_b];
  v_blocks := array[]::integer[];
  for v_id in 0..v_dealt - 1 loop
    v_blocks := v_blocks || v_flat[v_b + 1 + v_id * 5 : v_b + 5 + v_id * 5] || 1;
  end loop;

  foreach v_action in array coalesce(p_actions, array[]::integer[]) loop
    if v_action = 254 then
      -- Undo: the last snapshot, if this board has one.
      if v_moves = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_b := array_length(v_history, 1) - v_dealt * 6;
      v_blocks := v_history[v_b + 1 : v_b + v_dealt * 6];
      v_history := v_history[1 : v_b];
      v_moves := v_moves - 1;

    elsif v_action = 255 then
      -- Restart: the board as dealt.
      if v_moves = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_blocks := array[]::integer[];
      v_b := 3 + v_flat[2];
      v_b := v_b + 1 + 3 * v_flat[v_b];
      for v_id in 0..v_dealt - 1 loop
        v_blocks := v_blocks || v_flat[v_b + 1 + v_id * 5 : v_b + 5 + v_id * 5] || 1;
      end loop;
      v_history := array[]::integer[];
      v_moves := 0;

    else
      -- A move: the block whose top-left cell is `anchor`, slid `dir`.
      if v_action < 0 or v_action >= v_side * v_side * 4 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_anchor := v_action / 4;
      v_dir := v_action % 4;
      v_id := null;
      for v_b in 0..v_dealt - 1 loop
        if v_blocks[v_b * 6 + 6] = 1
           and v_blocks[v_b * 6 + 1] * v_side + v_blocks[v_b * 6 + 2] = v_anchor then
          v_id := v_b;
          exit;
        end if;
      end loop;
      if v_id is null then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;
      v_slide := public.huedini_slide(v_side, v_walls, v_gates, v_blocks, v_id, v_dir);
      if v_slide[1] = 0 then
        v_result.outcome := 'invalid_actions';
        v_result.session_id := v_session.id;
        v_result.game_slug := v_game.slug;
        return v_result;
      end if;

      v_history := v_history || v_blocks;
      if v_slide[1] = 2 then
        v_blocks[v_id * 6 + 6] := 0;
      else
        v_blocks[v_id * 6 + 1] := v_slide[2];
        v_blocks[v_id * 6 + 2] := v_slide[3];
      end if;
      v_moves := v_moves + 1;
      v_placed := v_placed + 1;

      v_left := 0;
      for v_b in 0..v_dealt - 1 loop
        v_left := v_left + v_blocks[v_b * 6 + 6];
      end loop;
      if v_left = 0 then
        -- Cleared: one unit a block, and the next board.
        v_score := v_score + v_dealt;
        v_total := v_total + 1;
        v_level := v_level + 1;
        v_flat := public.huedini_board(v_session.seed, v_level);
        v_side := v_flat[1];
        v_walls := v_flat[3 : 2 + v_flat[2]];
        v_b := 3 + v_flat[2];
        v_gates := v_flat[v_b + 1 : v_b + 3 * v_flat[v_b]];
        v_b := v_b + 1 + 3 * v_flat[v_b];
        v_dealt := v_flat[v_b];
        v_blocks := array[]::integer[];
        for v_id in 0..v_dealt - 1 loop
          v_blocks := v_blocks || v_flat[v_b + 1 + v_id * 5 : v_b + 5 + v_id * 5] || 1;
        end loop;
        v_history := array[]::integer[];
        v_moves := 0;
      end if;
    end if;
  end loop;

  -- A run that stops mid-board is the clock running out or the player ending
  -- it, and it is scored as it stands. It must still reach the server within the
  -- clock its cleared boards earned.
  if v_elapsed > public.huedini_budget_ms(v_total) + public.huedini_slack_ms() then
    v_result.outcome := 'out_of_time';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    return v_result;
  end if;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.session_id := v_session.id;
    v_result.game_slug := v_game.slug;
    v_result.score := v_score;
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
  v_result.cleared_columns := v_total;
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

comment on function public.complete_huedini_run(uuid, integer[], bigint, integer) is
  'Replays a submitted Huedini run from its session seed — slides, undos and restarts — derives the score and records it. A cleared board scores one unit per block and deals the next. Any prefix of a legal line is valid. A run that arrives later than its clock allowed is out_of_time. The claim is compared, never trusted.';

revoke all on function public.complete_huedini_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_huedini_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Start a run: the gate learns Huedini
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
     or (v_game.runtime = 'mini-sudoku' and p_rules_version = public.mini_sudoku_rules_version())
     or (v_game.runtime = 'scatter' and p_rules_version = public.scatter_rules_version())
     or (v_game.runtime = 'huedini' and p_rules_version = public.huedini_rules_version()) then
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
                                          'mini-sudoku@1', 'scatter@1',
                                          'huedini@1')
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
                             when 'scatter' then public.scatter_max_actions()
                             when 'huedini' then public.huedini_max_actions()
                             else public.stack10_tiles()
                           end;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. Stack 10 accepts stack-10@1 (legacy) and stack-10@2 (endless); Chain accepts chain@1 and chain@2; Memory Flash accepts memory-flash@1 (legacy) and memory-flash@2 (endless); One Move accepts one-move@1 (legacy) and one-move@2 (endless); Color Merge accepts color-merge@1 and color-merge@2; Don''t Touch the Black accepts dont-touch@1 and dont-touch@2; Queens accepts queens@1; Zip accepts zip@2 (and zip@1), 8 Puzzle accepts eight-puzzle@2 (and eight-puzzle@1), Tango accepts tango@2 (and tango@1), Sudoku accepts sudoku@3 (and sudoku@2 and sudoku@1), Gridburst accepts gridburst@1, Updraft accepts updraft@1 and Decant accepts decant@2 (and decant@1) — the @1 versions and sudoku@2 are the clocks before the taper; Mini Sudoku accepts mini-sudoku@1; Scatter accepts scatter@1; Huedini accepts huedini@1; 7 Second and the daily crossword (crossword@1) also answer already_played once the signed-in player has finished today''s.';
