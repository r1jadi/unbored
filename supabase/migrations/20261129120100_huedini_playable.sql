-- Huedini joins the catalogue, playable.
--
-- `20261129120000_huedini_sessions.sql` creates the verifier and teaches the
-- start gate the (`huedini`, `huedini@1`) pair; this migration is the other half
-- and lands last, in the same order as every game before it:
--
--   1. apply `20261129120000_huedini_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `huedini@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'huedini',
  'Huedini',
  'Every block escapes. Find the order.',
  'Coloured blocks, a few walls, and a gate of each colour in the frame. Drag a block and it slides until something stops it; line it up with its own gate and it slips out. Blocks stand in each other''s way, so every board is a puzzle about order, against a clock that each cleared board winds back.',
  'Drag a block up, down, left or right and it slides until a wall, another block or the edge stops it. A block that reaches a gate of its own colour, lined up so the gate covers its whole width, leaves the board. Clear every block for 10 points each and time for the next board; undo or restart a board any time. The clock starts at 75 seconds, the boards grow trickier, and the time they add tightens as the run goes. The run ends when the clock runs out or when you end it.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'huedini', now()
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
     where slug = 'huedini' and playable and runtime = 'huedini' and status = 'published'
  ) then
    raise exception 'huedini is not playable after the insert: its runtime is not the one this migration sets';
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
