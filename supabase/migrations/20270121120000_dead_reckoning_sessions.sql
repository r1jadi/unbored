-- Dead Reckoning (`dead-reckoning@1`): seven rounds of numbers a day, verified by
-- the database.
--
-- Every round gives a number and thirty seconds: four ask the player to name
-- something from a list whose real value is closest to it, three to estimate a
-- number. The nearer, the more points; the points drain as the clock runs, and one
-- round a day is golden and counts double.
--
--   1. The rules version, the bound on a submission, and the bank: each list's
--      values and each day's rounds, written by
--      `bun scripts/generate-daily-banks.ts --write` from
--      `src/lib/games/dead-reckoning-bank.ts`.
--   2. `dead_reckoning_score(day, actions)`: the replay, null for a run that is not
--      legal.
--   3. `complete_dead_reckoning_run`, the verifier: the generic gate, one
--      completion a day (`already_played`), the replay, and `speed_run_finish`.
--   4. The registry row. The day seed is `20270121120100_dead_reckoning_start.sql`.
--
-- Nothing a user can see changes: `20270121120200_dead_reckoning_playable.sql`
-- flips the catalogue and lands last. Mirrored by src/lib/games/dead-reckoning.ts.
-- See docs/games/README.md.

create or replace function public.dead_reckoning_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'dead-reckoning@1'::text $$;

create or replace function public.dead_reckoning_max_actions()
returns integer language sql immutable set search_path = '' as $$ select 7 $$;

comment on function public.dead_reckoning_rules_version() is
  'The Dead Reckoning rules version: dead-reckoning@1.';
comment on function public.dead_reckoning_max_actions() is
  'The most moves one Dead Reckoning submission may carry: one a round, 7.';

-- A list's values, by the entry's index (element i + 1 is entry i).
create or replace function public.dead_reckoning_values(p_category integer)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_category
    -- dead-reckoning-values:begin
    when 0 then array[8849, 8611, 8586, 8516, 8485, 8188, 8167, 8163, 8126, 8091, 8027, 6961, 6893, 6768, 6438, 6263, 6190, 5959, 5895, 5897, 5642, 5636, 5610, 5426, 5199, 5137, 5109, 5054, 4892, 4884, 4806, 4634, 4550, 4478, 4421, 4401, 4392, 4322, 4302, 4207, 4167, 4158, 4095, 3967, 3798, 3794, 3776, 3724, 3715, 3429, 3357, 2962, 2918, 2549, 2285, 2228, 1917, 1345, 1281, 1085]
    when 1 then array[6650, 6400, 6300, 5464, 4880, 4700, 4400, 4350, 4248, 4180, 3767, 3730, 3650, 3531, 3487, 3185, 3180, 3051, 2914, 2900, 2850, 2824, 2815, 2800, 2574, 2525, 2508, 2450, 2428, 2330, 2201, 2140, 2000, 1870, 1850, 1750, 1738, 1579, 1233, 1094, 1047, 1007, 1006, 777, 652, 346]
    when 2 then array[828, 679, 634, 632, 601, 599, 555, 553, 541, 540, 530, 508, 492, 484, 468, 462, 452, 442, 435, 381, 368, 367, 330, 321, 319, 310, 260, 227, 192, 184, 180, 169, 162, 157, 139, 137, 96, 93, 87, 56]
    when 3 then array[1265, 1254, 1412, 1451, 1452, 1473, 1475, 1491, 1533, 1564, 1564, 1606, 1643, 1685, 1732, 1756, 1769, 1770, 1775, 1809, 1809, 1810, 1812, 1815, 1818, 1819, 1820, 1822, 1828, 1835, 1840, 1847, 1853, 1856, 1856, 1867, 1869, 1874, 1879, 1881, 1890, 1897, 1901, 1904, 1907, 1910, 1912, 1918, 1926, 1926, 1929, 1930, 1935, 1940, 1940, 1942, 1955, 1955, 1958]
    when 4 then array[17098246, 9984670, 9833520, 9596961, 8515767, 7692024, 3287263, 2780400, 2724900, 2381741, 2344858, 2149690, 1964375, 1904569, 1886068, 1759540, 1648195, 1564110, 1285216, 1284000, 1267000, 1246700, 1240192, 1221037, 1141748, 1104300, 1098581, 1002450, 947303, 923768, 916445, 881913, 783562, 756102, 676578, 652230, 603550, 587041, 580367, 513120, 505990, 450295, 446550, 438317, 385207, 377975, 357022, 338424, 331212, 312696, 301340, 300000, 268021, 242495, 238391, 131957, 110994, 109884, 103000, 100210, 93030, 92212, 83871, 78871, 70273, 56594, 41850, 41285, 30528, 28748, 25713, 20271, 13812, 10991, 10887, 2586, 316]
    -- dead-reckoning-values:end
  end
$$;

create or replace function public.dead_reckoning_puzzle_count()
returns integer language sql immutable set search_path = '' as $$
  select
    -- dead-reckoning-count:begin
    120
    -- dead-reckoning-count:end
$$;

create or replace function public.dead_reckoning_puzzle_for(p_day bigint)
returns integer language sql immutable set search_path = '' as $$
  select (((p_day % public.dead_reckoning_puzzle_count()) + public.dead_reckoning_puzzle_count())
          % public.dead_reckoning_puzzle_count())::integer
$$;

-- A day: seven (list, scale, target) triples, the list -1 for an estimate and the
-- scale 0 for a quantity or 1 for a year, then the golden round's place (0 to 6).
create or replace function public.dead_reckoning_puzzle(p_puzzle integer)
returns integer[] language sql immutable set search_path = '' as $$
  select case p_puzzle
    -- dead-reckoning-bank:begin
    when 0 then array[-1, 1, 1929, -1, 0, 118, 2, 0, 440, 4, 0, 1100000, 3, 1, 1812, -1, 0, 42195, 1, 0, 1050, 0]
    when 1 then array[-1, 1, 1886, -1, 0, 86400, 0, 0, 5960, 3, 1, 1912, 4, 0, 242000, -1, 1, 1776, 2, 0, 260, 3]
    when 2 then array[3, 1, 1254, -1, 0, 775, 0, 0, 1090, -1, 0, 82, 1, 0, 4700, -1, 1, 1914, 4, 0, 9800000, 6]
    when 3 then array[4, 0, 132000, 1, 0, 780, -1, 1, 1998, 0, 0, 1280, -1, 0, 46, 2, 0, 600, -1, 1, 1815, 0]
    when 4 then array[-1, 0, 1609, 3, 1, 1890, 0, 0, 5400, 1, 0, 1010, 2, 0, 555, -1, 1, 1869, -1, 0, 32, 3]
    when 5 then array[-1, 0, 10935, 4, 0, 7700000, -1, 1, 1919, 3, 1, 1732, 2, 0, 830, -1, 1, 1861, 1, 0, 5460, 3]
    when 6 then array[2, 0, 87, 0, 0, 5600, -1, 1, 1666, 4, 0, 2720000, 3, 1, 1822, -1, 0, 212, -1, 0, 3474, 0]
    when 7 then array[1, 0, 650, -1, 0, 687, -1, 1, 1912, -1, 1, 1215, 3, 1, 1940, 4, 0, 30500, 0, 0, 3780, 4]
    when 8 then array[-1, 1, 1066, 2, 0, 553, 4, 0, 1250000, 0, 0, 4900, -1, 0, 299792, -1, 0, 5280, 1, 0, 346, 3]
    when 9 then array[-1, 1, 1453, 2, 0, 368, 3, 1, 1926, 0, 0, 5640, -1, 1, 2006, -1, 0, 40075, 1, 0, 3200, 0]
    when 10 then array[-1, 1, 2002, 4, 0, 1280000, 3, 1, 1926, -1, 0, 14, 1, 0, 3180, 2, 0, 634, -1, 0, 343, 5]
    when 11 then array[-1, 1, 2007, 3, 1, 1820, -1, 0, 366, 0, 0, 5200, 2, 0, 310, -1, 1, 1928, 4, 0, 440000, 4]
    when 12 then array[-1, 0, 1391400, 4, 0, 880000, 1, 0, 2530, 3, 1, 1958, -1, 0, 22, 0, 0, 6260, -1, 1, 1953, 4]
    when 13 then array[-1, 1, 1517, -1, 1, 1989, 1, 0, 2200, 2, 0, 320, -1, 0, 300, 4, 0, 650000, 0, 0, 8100, 5]
    when 14 then array[3, 1, 1450, 0, 0, 4550, -1, 0, 147, -1, 1, 1914, 1, 0, 1010, 2, 0, 460, -1, 0, 150, 6]
    when 15 then array[2, 0, 540, -1, 1, 1889, -1, 0, 10080, 3, 1, 1942, -1, 1, 1859, 4, 0, 2150000, 1, 0, 1580, 6]
    when 16 then array[2, 0, 600, -1, 1, 2008, 4, 0, 1270000, 3, 1, 1770, -1, 0, 21196, 0, 0, 8850, -1, 0, 22, 6]
    when 17 then array[-1, 0, 384400, 0, 0, 8200, 4, 0, 357000, -1, 1, 1977, -1, 1, 79, 3, 1, 1452, 1, 0, 4250, 5]
    when 18 then array[2, 0, 330, -1, 1, 1912, -1, 0, 163, 1, 0, 2570, 0, 0, 1350, -1, 0, 454, 4, 0, 920000, 0]
    when 19 then array[3, 1, 1856, 1, 0, 2000, -1, 1, 1789, -1, 1, 1492, -1, 0, 27, 0, 0, 1920, 2, 0, 380, 2]
    when 20 then array[-1, 0, 12742, 4, 0, 447000, 1, 0, 6650, -1, 1, 2016, 2, 0, 630, 3, 1, 1606, -1, 0, 8760, 2]
    when 21 then array[-1, 1, 1990, 0, 0, 5140, 3, 1, 1475, -1, 1, 1990, 2, 0, 435, 4, 0, 506000, -1, 0, 206, 3]
    when 22 then array[1, 0, 3050, -1, 0, 305, 0, 0, 8600, 4, 0, 313000, 3, 1, 1910, -1, 0, 2073600, -1, 1, 1945, 4]
    when 23 then array[2, 0, 169, 1, 0, 1230, 4, 0, 268000, 0, 0, 2960, -1, 1, 1930, -1, 0, 273, -1, 1, 1917, 0]
    when 24 then array[3, 1, 1820, -1, 1, 1903, 1, 0, 2900, 2, 0, 96, -1, 0, 64, 0, 0, 8500, -1, 0, 88, 3]
    when 25 then array[3, 1, 1874, 2, 0, 180, -1, 0, 193, 1, 0, 1850, -1, 1, 1896, 4, 0, 756000, -1, 1, 1930, 2]
    when 26 then array[2, 0, 157, -1, 0, 2073600, -1, 0, 5570, -1, 1, 2004, 0, 0, 8500, 3, 1, 1643, 4, 0, 677000, 0]
    when 27 then array[3, 1, 1935, 0, 0, 8200, 4, 0, 9600000, -1, 0, 305, -1, 1, 1876, -1, 1, 1986, 1, 0, 1090, 2]
    when 28 then array[-1, 1, 1957, -1, 0, 147, 0, 0, 3800, 1, 0, 2140, -1, 0, 193, 4, 0, 10000000, 2, 0, 470, 2]
    when 29 then array[3, 1, 1412, -1, 1, 1969, -1, 1, 2020, 0, 0, 4160, 2, 0, 530, -1, 0, 212, 1, 0, 3530, 0]
    when 30 then array[4, 0, 28700, 2, 0, 510, -1, 0, 42195, 3, 1, 1870, -1, 0, 206, -1, 1, 1929, 1, 0, 2820, 3]
    when 31 then array[-1, 0, 384400, 0, 0, 4170, 3, 1, 1930, -1, 1, 1453, -1, 1, 1666, 4, 0, 1220000, 2, 0, 139, 1]
    when 32 then array[3, 1, 1815, -1, 0, 300, -1, 1, 1986, 0, 0, 4100, -1, 0, 86400, 1, 0, 2330, 4, 0, 25700, 4]
    when 33 then array[2, 0, 184, -1, 1, 1776, -1, 1, 1066, -1, 0, 343, 0, 0, 8600, 1, 0, 3500, 4, 0, 950000, 3]
    when 34 then array[-1, 0, 299792, -1, 0, 1391400, 1, 0, 1740, 2, 0, 227, 3, 1, 1840, 0, 0, 4900, -1, 1, 1492, 5]
    when 35 then array[3, 1, 1775, -1, 1, 1815, 1, 0, 2450, 2, 0, 162, -1, 1, 1969, 4, 0, 330000, -1, 0, 32, 1]
    when 36 then array[4, 0, 2780000, 3, 1, 1818, -1, 1, 1990, -1, 0, 40075, 0, 0, 4320, 2, 0, 490, -1, 0, 1609, 6]
    when 37 then array[4, 0, 2380000, 3, 1, 1930, 0, 0, 5050, -1, 1, 1914, -1, 1, 1912, 1, 0, 2900, -1, 0, 8760, 0]
    when 38 then array[1, 0, 1870, 4, 0, 84000, 2, 0, 320, 0, 0, 2550, -1, 0, 3474, -1, 0, 687, -1, 1, 1215, 3]
    when 39 then array[2, 0, 137, 3, 1, 1853, -1, 1, 2006, -1, 0, 22, -1, 1, 1953, 0, 0, 5900, 1, 0, 2500, 4]
    when 40 then array[-1, 1, 1914, 4, 0, 1900000, 3, 1, 1685, -1, 0, 366, 2, 0, 93, -1, 0, 775, 1, 0, 4350, 0]
    when 41 then array[2, 0, 367, -1, 0, 273, -1, 1, 1919, 3, 1, 1835, -1, 1, 1928, 4, 0, 1000000, 0, 0, 4400, 4]
    when 42 then array[-1, 1, 1903, 3, 1, 1918, -1, 0, 14, 1, 0, 3770, 4, 0, 93000, -1, 0, 10080, 0, 0, 4800, 5]
    when 43 then array[-1, 1, 2004, 2, 0, 192, 4, 0, 2590, 1, 0, 2430, 0, 0, 2290, -1, 1, 1859, -1, 0, 82, 2]
    when 44 then array[-1, 0, 64, 3, 1, 1756, -1, 1, 1957, 2, 0, 450, -1, 0, 88, 0, 0, 3970, 1, 0, 4200, 5]
    when 45 then array[3, 1, 1810, 2, 0, 484, -1, 0, 118, -1, 1, 79, -1, 1, 1930, 4, 0, 79000, 1, 0, 3730, 2]
    when 46 then array[-1, 1, 1945, 4, 0, 580000, 3, 1, 1907, 2, 0, 540, -1, 0, 12742, -1, 0, 10935, 0, 0, 8100, 5]
    when 47 then array[3, 1, 1564, -1, 1, 1869, 1, 0, 3650, 4, 0, 1140000, -1, 1, 1989, 0, 0, 4200, -1, 0, 163, 3]
    when 48 then array[-1, 0, 21196, 4, 0, 11000, -1, 1, 1886, 1, 0, 4900, 2, 0, 680, 0, 0, 4400, -1, 0, 5570, 1]
    when 49 then array[2, 0, 56, 1, 0, 6300, 0, 0, 8000, -1, 1, 1912, -1, 1, 2008, -1, 0, 46, 3, 1, 1828, 3]
    when 50 then array[2, 0, 330, -1, 0, 5280, -1, 1, 2007, 1, 0, 2800, 3, 1, 1955, -1, 0, 27, 4, 0, 920000, 5]
    when 51 then array[-1, 1, 1889, -1, 1, 1876, 0, 0, 2230, -1, 0, 454, 2, 0, 56, 3, 1, 1867, 4, 0, 111000, 4]
    when 52 then array[3, 1, 1856, -1, 1, 1917, -1, 0, 150, -1, 0, 22, 4, 0, 70000, 1, 0, 4400, 0, 0, 4630, 3]
    when 53 then array[-1, 0, 5280, -1, 1, 1896, 4, 0, 100000, 2, 0, 162, 0, 0, 4400, 1, 0, 2820, -1, 1, 1517, 3]
    when 54 then array[-1, 1, 2002, -1, 0, 32, 1, 0, 6400, 3, 1, 1533, 0, 0, 3360, 2, 0, 260, -1, 0, 163, 3]
    when 55 then array[3, 1, 1473, 2, 0, 169, 4, 0, 300000, -1, 0, 775, -1, 1, 2016, 1, 0, 2850, -1, 1, 1861, 0]
    when 56 then array[-1, 0, 206, 3, 1, 1847, 0, 0, 2920, 4, 0, 10900, 2, 0, 540, -1, 0, 12742, -1, 1, 1990, 2]
    when 57 then array[-1, 1, 2020, 0, 0, 8200, -1, 1, 1998, 1, 0, 1750, 4, 0, 587000, 3, 1, 1900, -1, 0, 687, 1]
    when 58 then array[2, 0, 510, 1, 0, 2850, -1, 0, 343, 4, 0, 1650000, 0, 0, 6440, -1, 1, 1930, -1, 0, 22, 4]
    when 59 then array[3, 1, 1564, 0, 0, 6800, 2, 0, 368, -1, 1, 1789, 1, 0, 2200, -1, 1, 1977, -1, 0, 299792, 0]
    when 60 then array[-1, 1, 1986, -1, 0, 46, -1, 0, 273, 3, 1, 1955, 2, 0, 600, 1, 0, 3530, 4, 0, 316, 4]
    when 61 then array[3, 1, 1880, -1, 1, 1945, 2, 0, 484, -1, 0, 305, -1, 1, 1903, 0, 0, 3700, 4, 0, 13800, 4]
    when 62 then array[3, 1, 1490, 1, 0, 4250, 0, 0, 5100, 4, 0, 450000, -1, 0, 366, -1, 1, 1776, -1, 0, 8760, 1]
    when 63 then array[-1, 1, 1928, 2, 0, 139, -1, 1, 1929, 1, 0, 2820, -1, 0, 3474, 4, 0, 378000, 0, 0, 6900, 4]
    when 64 then array[2, 0, 157, -1, 1, 1896, 3, 1, 1880, -1, 0, 10080, 1, 0, 3050, -1, 0, 14, 0, 0, 5900, 2]
    when 65 then array[-1, 0, 193, 2, 0, 470, -1, 1, 1453, 4, 0, 110000, -1, 1, 2008, 1, 0, 3200, 3, 1, 1940, 0]
    when 66 then array[-1, 0, 42195, -1, 0, 212, -1, 1, 1889, 0, 0, 3800, 2, 0, 184, 4, 0, 1760000, 3, 1, 1770, 4]
    when 67 then array[-1, 0, 10935, 0, 0, 4500, 4, 0, 238000, -1, 1, 1930, 3, 1, 1810, -1, 1, 1066, 1, 0, 6400, 0]
    when 68 then array[4, 0, 513000, 1, 0, 4700, -1, 0, 150, -1, 1, 1912, 2, 0, 450, 0, 0, 6960, -1, 0, 88, 5]
    when 69 then array[-1, 1, 1876, 0, 0, 6200, 3, 1, 1265, 1, 0, 3730, -1, 0, 454, -1, 1, 1666, 2, 0, 440, 3]
    when 70 then array[2, 0, 180, 4, 0, 1960000, -1, 0, 384400, -1, 1, 1930, -1, 0, 40075, 3, 1, 1897, 1, 0, 2570, 0]
    when 71 then array[-1, 0, 300, 0, 0, 3430, -1, 1, 2007, 2, 0, 380, -1, 1, 1912, 3, 1, 1904, 4, 0, 20300, 6]
    when 72 then array[1, 0, 6650, 0, 0, 4300, 3, 1, 1810, -1, 0, 21196, 4, 0, 780000, -1, 1, 2020, -1, 0, 2073600, 3]
    when 73 then array[4, 0, 1890000, -1, 0, 82, -1, 1, 79, 0, 0, 5640, 2, 0, 192, -1, 1, 2004, 1, 0, 2500, 1]
    when 74 then array[2, 0, 320, -1, 0, 86400, -1, 1, 1914, 1, 0, 1090, 3, 1, 1810, 0, 0, 3720, -1, 0, 22, 3]
    when 75 then array[-1, 1, 1886, 1, 0, 1750, -1, 1, 1989, -1, 0, 118, 3, 1, 1930, 4, 0, 604000, 2, 0, 600, 5]
    when 76 then array[-1, 1, 1977, 3, 1, 1564, -1, 0, 1609, 0, 0, 5140, 2, 0, 310, -1, 0, 1391400, 4, 0, 92000, 4]
    when 77 then array[-1, 1, 2006, 3, 1, 1775, -1, 0, 64, -1, 1, 1914, 4, 0, 3300000, 1, 0, 1230, 0, 0, 5050, 1]
    when 78 then array[-1, 0, 27, 1, 0, 3500, -1, 0, 5570, 4, 0, 385000, -1, 1, 1861, 2, 0, 555, 0, 0, 4400, 3]
    when 79 then array[3, 1, 1856, -1, 1, 1917, -1, 0, 147, 1, 0, 4200, 0, 0, 3970, 2, 0, 630, -1, 1, 1215, 5]
    when 80 then array[3, 1, 1770, 2, 0, 460, -1, 0, 64, -1, 1, 1990, -1, 0, 366, 4, 0, 41300, 1, 0, 780, 4]
    when 81 then array[2, 0, 680, 0, 0, 4160, 4, 0, 1560000, 3, 1, 1564, -1, 0, 22, -1, 1, 1957, -1, 1, 1953, 5]
    when 82 then array[0, 0, 2550, -1, 0, 775, 1, 0, 1580, 3, 1, 1940, -1, 1, 1815, 4, 0, 2340000, -1, 0, 2073600, 4]
    when 83 then array[-1, 1, 1969, -1, 0, 5280, 4, 0, 300000, 1, 0, 1870, -1, 1, 1990, 2, 0, 530, 0, 0, 4320, 6]
    when 84 then array[0, 0, 2960, 3, 1, 1880, 2, 0, 87, -1, 0, 14, 1, 0, 3180, -1, 0, 384400, -1, 1, 2002, 4]
    when 85 then array[3, 1, 1820, -1, 1, 1859, -1, 1, 2016, 1, 0, 2800, 2, 0, 435, 4, 0, 1100000, -1, 0, 206, 3]
    when 86 then array[4, 0, 8500000, -1, 0, 32, 2, 0, 367, -1, 1, 1517, 3, 1, 1940, 0, 0, 4400, -1, 0, 687, 0]
    when 87 then array[3, 1, 1818, 1, 0, 2450, 4, 0, 340000, -1, 1, 1919, 0, 0, 8850, -1, 1, 1789, -1, 0, 22, 6]
    when 88 then array[4, 0, 56600, -1, 1, 1869, -1, 0, 10935, -1, 0, 273, 1, 0, 1010, 2, 0, 137, 0, 0, 5900, 2]
    when 89 then array[0, 0, 4900, -1, 1, 1492, 3, 1, 1452, -1, 0, 88, -1, 1, 1998, 2, 0, 320, 1, 0, 2900, 0]
    when 90 then array[1, 0, 3770, 2, 0, 553, -1, 0, 10080, -1, 1, 2007, 3, 1, 1473, -1, 0, 46, 4, 0, 1290000, 2]
    when 91 then array[2, 0, 227, -1, 1, 1977, -1, 1, 1859, 3, 1, 1820, 0, 0, 5640, -1, 0, 1391400, 4, 0, 1240000, 2]
    when 92 then array[0, 0, 4800, 1, 0, 2330, -1, 0, 5570, -1, 1, 2008, 4, 0, 17100000, -1, 0, 299792, 3, 1, 1490, 0]
    when 93 then array[-1, 1, 1453, -1, 0, 305, -1, 1, 2004, 2, 0, 96, 1, 0, 650, 0, 0, 3700, 4, 0, 103000, 4]
    when 94 then array[2, 0, 93, 1, 0, 2430, -1, 0, 147, -1, 1, 1945, -1, 0, 1609, 0, 0, 6900, 3, 1, 1265, 5]
    when 95 then array[-1, 1, 1066, 3, 1, 1904, 4, 0, 42000, -1, 1, 1953, 2, 0, 540, 1, 0, 4900, -1, 0, 300, 4]
    when 96 then array[-1, 0, 3474, -1, 1, 1990, -1, 0, 42195, 3, 1, 1955, 0, 0, 6960, 2, 0, 634, 4, 0, 920000, 2]
    when 97 then array[-1, 1, 1789, 3, 1, 1856, -1, 1, 79, -1, 0, 193, 4, 0, 79000, 1, 0, 1050, 0, 0, 8000, 5]
    when 98 then array[1, 0, 2900, -1, 1, 1666, 0, 0, 3780, 4, 0, 1900000, -1, 0, 118, 2, 0, 490, -1, 0, 82, 4]
    when 99 then array[-1, 1, 1986, 0, 0, 4900, -1, 0, 12742, 1, 0, 4350, 3, 1, 1870, -1, 1, 1990, 2, 0, 830, 1]
    when 100 then array[-1, 1, 1928, -1, 0, 21196, 3, 1, 1958, -1, 0, 86400, 1, 0, 1850, 2, 0, 139, 4, 0, 11000, 3]
    when 101 then array[2, 0, 310, 0, 0, 8500, -1, 1, 1815, 4, 0, 9800000, 3, 1, 1926, -1, 0, 212, -1, 1, 1998, 3]
    when 102 then array[1, 0, 2530, -1, 0, 163, -1, 0, 27, 4, 0, 650000, -1, 1, 1876, 3, 1, 1450, 0, 0, 3360, 0]
    when 103 then array[-1, 0, 454, 0, 0, 4400, -1, 1, 1930, 2, 0, 490, 1, 0, 346, 4, 0, 30500, -1, 1, 1989, 1]
    when 104 then array[1, 0, 3650, -1, 0, 150, 0, 0, 8200, 2, 0, 600, -1, 1, 2016, -1, 0, 40075, 3, 1, 1685, 3]
    when 105 then array[-1, 0, 8760, 3, 1, 1874, 1, 0, 2000, -1, 1, 1903, -1, 1, 2002, 2, 0, 368, 4, 0, 330000, 6]
    when 106 then array[-1, 1, 1912, 4, 0, 8500000, 3, 1, 1867, -1, 0, 687, -1, 0, 343, 0, 0, 6800, 2, 0, 96, 5]
    when 107 then array[1, 0, 2140, 4, 0, 1140000, -1, 1, 1869, 0, 0, 5640, 3, 1, 1910, -1, 0, 454, -1, 1, 1969, 1]
    when 108 then array[-1, 0, 150, 4, 0, 1960000, 2, 0, 680, 1, 0, 1740, -1, 1, 1914, 0, 0, 3800, -1, 0, 14, 6]
    when 109 then array[-1, 0, 1391400, 2, 0, 137, -1, 1, 2020, 1, 0, 2820, 0, 0, 4170, -1, 1, 2006, 3, 1, 1810, 6]
    when 110 then array[4, 0, 132000, 1, 0, 4400, -1, 0, 5280, 3, 1, 1955, 2, 0, 260, -1, 0, 2073600, -1, 1, 1896, 0]
    when 111 then array[0, 0, 8600, -1, 0, 40075, 3, 1, 1606, 2, 0, 555, 4, 0, 2340000, -1, 1, 1886, -1, 1, 1776, 0]
    when 112 then array[3, 1, 1254, -1, 0, 118, 1, 0, 6300, 4, 0, 1760000, -1, 1, 1861, 0, 0, 3800, -1, 0, 300, 1]
    when 113 then array[-1, 1, 1919, 4, 0, 1560000, -1, 0, 775, 2, 0, 470, 1, 0, 1010, 0, 0, 6440, -1, 1, 1889, 1]
    when 114 then array[1, 0, 5460, -1, 0, 193, 0, 0, 4100, 2, 0, 192, -1, 0, 163, 3, 1, 1942, -1, 1, 1517, 0]
    when 115 then array[-1, 1, 1215, -1, 1, 1912, 2, 0, 184, 4, 0, 1220000, 3, 1, 1907, -1, 0, 64, 1, 0, 3730, 2]
    when 116 then array[2, 0, 56, -1, 0, 273, 4, 0, 92000, 3, 1, 1412, -1, 0, 42195, 0, 0, 4200, -1, 1, 1917, 2]
    when 117 then array[0, 0, 5600, 4, 0, 10900, 3, 1, 1810, -1, 0, 3474, -1, 1, 1930, -1, 1, 1492, 1, 0, 4200, 3]
    when 118 then array[-1, 0, 22, 0, 0, 5100, -1, 0, 10080, 4, 0, 2780000, -1, 1, 1957, 1, 0, 2800, 2, 0, 180, 3]
    when 119 then array[-1, 0, 8760, 1, 0, 780, -1, 1, 1914, -1, 1, 1929, 0, 0, 4550, 2, 0, 330, 3, 1, 1475, 2]
    -- dead-reckoning-bank:end
  end
$$;

comment on function public.dead_reckoning_values(integer) is
  'dead-reckoning@1''s lists'' values. Mirrored by src/lib/games/dead-reckoning-bank.ts.';
comment on function public.dead_reckoning_puzzle(integer) is
  'dead-reckoning@1''s days: seven (list, scale, target) rounds and the golden one. Mirrored by src/lib/games/dead-reckoning-bank.ts.';

-- The score a day's moves make, or null when they are not a legal run.
--
-- A move is (answer + 1) * 32 + seconds: seconds 0 to 30 left on the clock, and
-- the answer an entry's index in the round's list or an estimate (0 to 9 999 999),
-- answer + 1 = 0 meaning the clock ran out. One move a round, at most seven.
--
-- The error in thousandths is |value - target| * 1000 / span (span the target, or
-- 100 for a year): within 10 scores 100, 30 75, 70 50, 150 30, 300 10, else 0;
-- the round scores floor(points * (20 + seconds) / 50), doubled in the golden one.
create or replace function public.dead_reckoning_score(p_day bigint, p_actions integer[])
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_bank     integer[] := public.dead_reckoning_puzzle(public.dead_reckoning_puzzle_for(p_day));
  v_golden   integer := v_bank[22];
  v_round    integer := 0;
  v_total    bigint := 0;
  v_action   integer;
  v_seconds  integer;
  v_answer   integer;
  v_category integer;
  v_scale    integer;
  v_target   bigint;
  v_values   integer[];
  v_value    bigint;
  v_span     bigint;
  v_off      bigint;
  v_points   integer;
begin
  if coalesce(cardinality(p_actions), 0) > 7 then
    return null;
  end if;

  foreach v_action in array coalesce(p_actions, '{}'::integer[]) loop
    if v_action is null or v_action < 0 then
      return null;
    end if;
    v_seconds := v_action % 32;
    v_answer := v_action / 32 - 1;
    if v_seconds > 30 then
      return null;
    end if;

    v_category := v_bank[v_round * 3 + 1];
    v_scale := v_bank[v_round * 3 + 2];
    v_target := v_bank[v_round * 3 + 3];
    v_points := 0;

    if v_answer >= 0 then
      if v_category >= 0 then
        v_values := public.dead_reckoning_values(v_category);
        if v_answer >= cardinality(v_values) then
          return null;
        end if;
        v_value := v_values[v_answer + 1];
      else
        if v_answer > 9999999 then
          return null;
        end if;
        v_value := v_answer;
      end if;

      v_span := case when v_scale = 1 then 100 else v_target end;
      v_off := abs(v_value - v_target) * 1000;
      v_points := case
        when v_off <= 10 * v_span then 100
        when v_off <= 30 * v_span then 75
        when v_off <= 70 * v_span then 50
        when v_off <= 150 * v_span then 30
        when v_off <= 300 * v_span then 10
        else 0
      end;
      v_points := (v_points * (20 + v_seconds)) / 50;
      if v_round = v_golden then
        v_points := v_points * 2;
      end if;
    end if;

    v_total := v_total + v_points;
    v_round := v_round + 1;
  end loop;

  return v_total;
end;
$$;

comment on function public.dead_reckoning_score(bigint, integer[]) is
  'A Dead Reckoning day''s moves replayed: points by how near each answer is, drained by the clock and doubled in the golden round; null when the moves are not a legal run.';

revoke all on function public.dead_reckoning_values(integer) from public;
revoke all on function public.dead_reckoning_puzzle(integer) from public;
revoke all on function public.dead_reckoning_score(bigint, integer[]) from public;

create or replace function public.complete_dead_reckoning_run(
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
    public.dead_reckoning_rules_version(), public.dead_reckoning_max_actions());
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

  v_score := public.dead_reckoning_score((v_gate.session).seed, p_actions);
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

comment on function public.complete_dead_reckoning_run(uuid, integer[], bigint, integer) is
  'Dead Reckoning: replays a day''s answers on the day''s rounds and records the score.';

revoke all on function public.complete_dead_reckoning_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_dead_reckoning_run(uuid, integer[], bigint, integer) to anon, authenticated;

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('dead-reckoning', public.dead_reckoning_rules_version(), public.dead_reckoning_max_actions(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;
