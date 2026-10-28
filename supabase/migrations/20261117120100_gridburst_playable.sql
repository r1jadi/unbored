-- Gridburst joins the catalogue, playable.
--
-- `20261117120000_gridburst_sessions.sql` creates the verifier and teaches the
-- start gate the (`gridburst`, `gridburst@1`) pair; this migration is the other
-- half and lands last, in the same order as every game before it:
--
--   1. apply `20261117120000_gridburst_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `gridburst@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'gridburst',
  'Gridburst',
  'Drop the pieces. Fill a line. Watch it burst.',
  'An 8×8 grid and three pieces at a time. Fill a whole row or column and it bursts; burst again soon after and the combo multiplies your points. The pieces get bigger as you go, and the run ends when nothing in your tray fits.',
  'Drag a piece from the tray onto the grid, or tap a piece and then a square. A full row or column bursts. Every square placed is a point; a burst of L lines scores 10 × L² times your combo, which grows with every burst and resets after three placements without one. Empty the whole board for 300 more. Place all three pieces and three more arrive; the run ends when none of them fits.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'gridburst', now()
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
     where slug = 'gridburst' and playable and runtime = 'gridburst' and status = 'published'
  ) then
    raise exception 'gridburst is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the fourteen shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
