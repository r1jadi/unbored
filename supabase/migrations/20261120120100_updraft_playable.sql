-- Updraft joins the catalogue, playable.
--
-- `20261120120000_updraft_sessions.sql` creates the verifier and teaches the
-- start gate the (`updraft`, `updraft@1`) pair; this migration is the other
-- half and lands last, in the same order as every game before it:
--
--   1. apply `20261120120000_updraft_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `updraft@1` completions to the new
--      verifier and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'updraft',
  'Updraft',
  'Tap to rise. Thread the gaps.',
  'A glider, a stiff breeze and an endless line of columns. Tap to lift, let go to fall, and thread the gap in every column. The wind picks up and the gaps narrow as you go; one touch of a column or the ground and the run is over.',
  'Tap, click or press Space to flap: each flap lifts the glider, and between flaps it falls. Fly through the gap in each column for 10 points. Touching a column or the ground ends the run; the top of the sky is safe. The field speeds up and the gaps narrow as you go, with no last column.',
  (select c.id from public.categories c where c.slug = 'arcade'),
  'published', true, true, 'updraft', now()
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
     where slug = 'updraft' and playable and runtime = 'updraft' and status = 'published'
  ) then
    raise exception 'updraft is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the fifteen shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
