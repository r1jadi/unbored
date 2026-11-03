-- Cascade joins the catalogue, playable.
--
-- `20261202120000_cascade_sessions.sql` creates the verifier and teaches the
-- start gate the (`cascade`, `cascade@1`) pair; this migration is the other half
-- and lands last, in the same order as every game before it:
--
--   1. apply `20261202120000_cascade_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `cascade@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'cascade',
  'Cascade',
  'Swap two tiles. Line up three. Watch it fall.',
  'The swap-and-match puzzle on an 8×8 board: line up three or more of a kind, clear them, and let the tiles above fall into chain reactions. Four in a line leave a line tile, five or an L leave a burst, and every level winds the clock back.',
  'Swap two neighbouring tiles to line up three or more of the same shape in a row or a column. They clear, the tiles above fall and new ones drop in; every wave of a cascade scores more than the one before. Four in a line leave a line tile that clears its whole row or column, five in a line or an L or T leave a burst that clears the 3×3 around it. Each level asks for more tiles cleared and adds time: the clock starts at one minute, and the run ends when it runs out.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'cascade', now()
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
     where slug = 'cascade' and playable and runtime = 'cascade' and status = 'published'
  ) then
    raise exception 'cascade is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twenty shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
