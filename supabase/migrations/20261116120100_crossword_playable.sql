-- The daily crossword joins the catalogue, playable.
--
-- `20261116120000_crossword_sessions.sql` creates the verifier and teaches the
-- start gate the (`crossword`, `crossword@1`) pair; this migration is the other
-- half and lands last, in the same order as every game before it:
--
--   1. apply `20261116120000_crossword_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `crossword@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'crossword',
  'Daily Crossword',
  'One crossword a day. Solve it fast.',
  'A new crossword every day, the same for everyone: a 5×5 mini on weekdays and a 7×7 midi at the weekend, with original clues. The faster you solve it, the more it scores.',
  'Fill the grid so every across and down answer fits its clue. Pick a square and type; pick it again, or tap the clue, to switch direction. A mini is worth 1000 if solved within 30 seconds and a midi 2000 within a minute, then four points fewer a second. Checking the grid costs 50 and revealing a letter 100. One ranked solve a day; a new crossword arrives at midnight UTC.',
  (select c.id from public.categories c where c.slug = 'word'),
  'published', true, true, 'crossword', now()
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
     where slug = 'crossword' and playable and runtime = 'crossword' and status = 'published'
  ) then
    raise exception 'crossword is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the thirteen shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
