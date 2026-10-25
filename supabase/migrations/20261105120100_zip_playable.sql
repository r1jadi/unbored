-- Zip joins the catalogue, playable.
--
-- `20261105120000_zip_sessions.sql` creates the verifier and teaches the start
-- gate the (`zip`, `zip@1`) pair; this migration is the other half and lands
-- last, in the same order as every game before it:
--
--   1. apply `20261105120000_zip_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `zip@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'zip',
  'Zip',
  'One path. Every cell. Beat the clock.',
  'Draw one line through every cell, passing the numbers in order. Every board has one solution, and the clock never stops.',
  'Draw one path that starts on 1, passes through every number in order and ends on the highest, visiting every cell exactly once. Move up, down, left or right, never through a wall. Drag or tap to extend the path, and go back over it to undo. The clock starts at 60 seconds and every solved board adds five seconds a row. Each board is worth ten points a row, the boards grow from 5×5 to 7×7, and the run ends when the clock runs out or when you end it.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'zip', now()
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
     where slug = 'zip' and playable and runtime = 'zip' and status = 'published'
  ) then
    raise exception 'zip is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'queens', 'zip'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the nine shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
