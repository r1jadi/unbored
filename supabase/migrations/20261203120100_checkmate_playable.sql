-- Checkmate joins the catalogue, playable.
--
-- `20261203120000_checkmate_sessions.sql` creates the verifier and teaches the
-- start gate the (`checkmate`, `checkmate@1`) pair; this migration is the other half
-- and lands last, in the same order as every game before it:
--
--   1. apply `20261203120000_checkmate_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `checkmate@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'checkmate',
  'Checkmate',
  'One move wins it. Find it before the clock does.',
  'Chess puzzles against the clock: every position has exactly one way to checkmate. Mates in one to start, then mates in two, where the board answers your first move. Every solved puzzle winds the clock back.',
  'Find the checkmate: tap a piece, then the square to move it to. The first six puzzles are mates in one; after that they are mates in two, where the other side replies to your first move and you deliver mate with the second. A mate in one scores 100 and adds time, a mate in two 300 and more time, a little less as the run goes. A wrong move costs 10 seconds and the puzzle stays; Skip moves on for 20. The clock starts at 1:30, and the run ends when it runs out.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'checkmate', now()
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
     where slug = 'checkmate' and playable and runtime = 'checkmate' and status = 'published'
  ) then
    raise exception 'checkmate is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twenty-one shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
