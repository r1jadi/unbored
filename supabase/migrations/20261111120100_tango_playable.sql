-- Tango joins the catalogue, playable.
--
-- `20261111120000_tango_sessions.sql` creates the verifier and teaches the start
-- gate the (`tango`, `tango@1`) pair; this migration is the other half and lands
-- last, in the same order as every game before it:
--
--   1. apply `20261111120000_tango_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `tango@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'tango',
  'Tango',
  'Suns and moons. Three of each, every line.',
  'Fill the grid with suns and moons: three of each in every row and column, never three alike in a row, every sign obeyed. Beat the clock.',
  'Fill the 6×6 grid with suns and moons. Every row and every column holds three of each, and no three alike sit next to each other across or down. An = between two cells means they match; an × means they differ. Tap a cell for a sun, again for a moon, once more to clear it; cells that start filled stay as they are. The clock starts at two minutes and every solved board adds 45 seconds and sixty points. Each board starts with fewer cells filled, and the run ends when the clock runs out or when you end it.',
  (select c.id from public.categories c where c.slug = 'logic'),
  'published', true, true, 'tango', now()
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
     where slug = 'tango' and playable and runtime = 'tango' and status = 'published'
  ) then
    raise exception 'tango is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'queens', 'zip', '8-puzzle', 'tango'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the eleven shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
