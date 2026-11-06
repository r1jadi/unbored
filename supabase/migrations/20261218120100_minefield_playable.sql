-- Minefield joins the catalogue, playable.
--
-- `20261218120000_minefield_sessions.sql` creates the verifier and adds the
-- (`minefield`, `minefield@1`) row to the runtime registry; this migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply `20261218120000_minefield_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `minefield@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'minefield',
  'Minefield',
  'Every number is a clue.',
  'Open every safe cell of a hidden minefield, reading the numbers to work out where the mines lie. The first tap of a board is always safe, three lives forgive a bad guess, and the boards keep getting bigger and denser.',
  'Tap a cell to open it. A number says how many of the eight cells around it hide a mine, and a cell with none opens its neighbours too. Switch to Flag, long-press or right-click to flag a cell you think is a mine. Tap an opened number whose flags add up to open the rest of its neighbours. A mine costs a life, and the run ends when all three are gone. Each safe cell is worth 10 points, a cleared board 20 a row, and a board cleared without setting off a mine 10 more a row. Every third cleared board brings back a life. Boards grow from 8×8 to 10×10 and hold more mines as you go.',
  (select c.id from public.categories c where c.slug = 'logic'),
  'published', true, true, 'minefield', now()
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
     where slug = 'minefield' and playable and runtime = 'minefield' and status = 'published'
  ) then
    raise exception 'minefield is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twenty-four shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
