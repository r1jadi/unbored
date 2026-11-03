-- Scatter joins the catalogue, playable.
--
-- `20261128120000_scatter_sessions.sql` creates the verifier and teaches the
-- start gate the (`scatter`, `scatter@1`) pair; this migration is the other half
-- and lands last, in the same order as every game before it:
--
--   1. apply `20261128120000_scatter_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `scatter@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'scatter',
  'Scatter',
  'Clear the way. Every arrow out.',
  'A grid of arrow tiles, each one aching to leave. Tap a tile and it flies off the way it points, as long as nothing is in its lane. Turnstiles turn with every escape, so the order you clear the board in matters. Boards grow and crowd up as you go.',
  'Tap a tile and it flies off the board the way its arrow points, for 10 points, as long as nothing stands between it and the edge. A blocked tile jams and stays put; three jams end the run. Tiles with a turnstile badge turn a quarter clockwise every time a tile escapes. Clear a board for 50 more and the next one deals, bigger and busier; a board where no tile can leave is lost for a jam. There is no last board, and you can end the run any time.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'scatter', now()
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
     where slug = 'scatter' and playable and runtime = 'scatter' and status = 'published'
  ) then
    raise exception 'scatter is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the nineteen shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
