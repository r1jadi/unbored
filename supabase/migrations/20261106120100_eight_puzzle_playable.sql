-- 8 Puzzle joins the catalogue, playable.
--
-- `20261106120000_eight_puzzle_sessions.sql` creates the verifier and teaches the
-- start gate the (`eight-puzzle`, `eight-puzzle@1`) pair; this migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply `20261106120000_eight_puzzle_sessions.sql` — nothing a user can see
--      changes;
--   2. deploy the service that routes `eight-puzzle@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  '8-puzzle',
  '8 Puzzle',
  'Eight tiles. One gap. Slide them home.',
  'The classic sliding puzzle against the clock. Put the tiles back in order, then do it again, a little more scrambled each time.',
  'Tap a tile next to the gap to slide it in, or use the arrow keys. Put the tiles in order, 1 to 8 in reading order with the gap in the bottom-right corner. Every board can be solved, and each is scrambled a little more than the last. The clock starts at 60 seconds and every solved board adds 15 seconds and ten points. The run ends when the clock runs out or when you end it.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'eight-puzzle', now()
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
     where slug = '8-puzzle' and playable and runtime = 'eight-puzzle' and status = 'published'
  ) then
    raise exception '8-puzzle is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'queens', 'zip', '8-puzzle'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the ten shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
