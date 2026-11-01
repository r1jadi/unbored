-- Decant joins the catalogue, playable.
--
-- `20261121120000_decant_sessions.sql` creates the verifier and teaches the start
-- gate the (`decant`, `decant@1`) pair; this migration is the other half and
-- lands last, in the same order as every game before it:
--
--   1. apply `20261121120000_decant_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `decant@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'decant',
  'Decant',
  'Pour until every tube is one colour.',
  'Tubes of stacked colour and two empty ones. Pour from tube to tube until every tube holds a single colour, against a clock that each sorted board winds back. Boards start with three colours and gain one every second board, up to nine.',
  'Tap a tube, then the tube to pour it into. A pour only lands on an empty tube or on the same colour, and the whole top layer of that colour goes, as much as fits. Sort every tube into one colour to solve the board: 10 points and 5 more seconds per colour. Undo a pour, restart the board, or add one empty tube to it for 15 seconds of clock. The run ends when the clock does.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'decant', now()
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
     where slug = 'decant' and playable and runtime = 'decant' and status = 'published'
  ) then
    raise exception 'decant is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the sixteen shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
