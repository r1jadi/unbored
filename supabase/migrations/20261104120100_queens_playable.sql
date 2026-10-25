-- Queens joins the catalogue, playable.
--
-- `20261104120000_queens_sessions.sql` creates the verifier and teaches the start
-- gate the (`queens`, `queens@1`) pair; this migration is the other half of the
-- same change and is deliberately separate, because the two must land in order:
--
--   1. apply `20261104120000_queens_sessions.sql` — nothing a user can see
--      changes yet;
--   2. deploy the service that routes `queens@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.
--
-- Applied in the other order, the catalogue would offer a Play button whose runs
-- no deployment can verify yet. Unlike the first seven games, Queens was never in
-- the original catalogue, so this migration inserts its record rather than
-- flipping one — official, published and playable in the same statement, because
-- `playable` is a statement about shipped code and the code ships with it.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'queens',
  'Queens',
  'One Queen per row, column and colour.',
  'Place a Queen in every row, column and colour region, with no two touching. Every board has one solution, and the boards keep coming.',
  'Every board is split into coloured regions. Place exactly one Queen in each row, each column and each region; two Queens can never touch, not even diagonally. Tap a cell once for an X, twice for a Queen, and a third time to clear it. A Queen off the solution is a mistake, and the third mistake ends the run. Each solved board is worth ten points a row, the boards grow from 5×5 to 9×9, and you can end the run whenever you like.',
  (select c.id from public.categories c where c.slug = 'logic'),
  'published', true, true, 'queens', now()
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

-- The same guard every flip carries: the new game is playable with the runtime
-- this migration names, and none of the earlier runtimes was dragged along.
do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'queens' and playable and runtime = 'queens' and status = 'published'
  ) then
    raise exception 'queens is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'queens'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the eight shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
