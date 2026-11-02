-- Mini Sudoku joins the catalogue, playable.
--
-- `20261126120000_mini_sudoku_sessions.sql` creates the verifier and teaches the
-- start gate the (`mini-sudoku`, `mini-sudoku@1`) pair; this migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply `20261126120000_mini_sudoku_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `mini-sudoku@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'mini-sudoku',
  'Mini Sudoku',
  'Sudoku on a 6×6 grid. Quick to start, hard to put down.',
  'The small Sudoku: a 6×6 grid in boxes two rows tall and three wide, with the digits 1 to 6. Every board has exactly one solution, and every solved board winds the clock back.',
  'Fill the grid so every row, every column and every 2×3 box holds the digits 1 to 6 once each. Tap a cell, then a digit. Solve a board for 60 points and time for the next one: the clock starts at two minutes, and each board adds time, generous early on and tighter as the run goes. A wrong digit never ends a run; the clock does.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'mini-sudoku', now()
on conflict (slug) do update
  set title        = excluded.title,
      tagline      = excluded.tagline,
      description  = excluded.description,
      instructions = excluded.instructions,
      category_id  = excluded.category_id,
      status       = excluded.status,
      is_official  = excluded.is_official,
      playable     = excluded.playable,
      runtime      = excluded.runtime,
      -- A re-run keeps the original publication date.
      published_at = coalesce(public.games.published_at, excluded.published_at);

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'mini-sudoku' and playable and runtime = 'mini-sudoku' and status = 'published'
  ) then
    raise exception 'mini-sudoku is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the seventeen shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
