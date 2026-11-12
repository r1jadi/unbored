-- Flipside joins the catalogue, playable.
--
-- `20261230120000_flipside_sessions.sql` creates the verifier and adds the
-- (`flipside`, `flipside@1`) row to the runtime registry; this migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply `20261230120000_flipside_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `flipside@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'flipside',
  'Flipside',
  'One tap flips gravity. Don''t fall in.',
  'A runner tears along a tunnel. Tap and gravity flips: it falls to the ceiling, and back down on the next tap. Holes and spikes line both sides. Skim the spikes for a near-miss combo, and see how far you get as the tunnel speeds up.',
  'Tap, click or press Space to flip gravity. You can only flip from a surface; a tap made in the air waits for you to land. Falling into a hole or touching a spike ends the run. Every hazard cleared is 10 points, and passing spikes close without touching them earns a bonus that grows with every near miss in a row.',
  (select c.id from public.categories c where c.slug = 'arcade'),
  'published', true, true, 'flipside', now()
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
     where slug = 'flipside' and playable and runtime = 'flipside' and status = 'published'
  ) then
    raise exception 'flipside is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork', 'whittle', 'flipside'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
