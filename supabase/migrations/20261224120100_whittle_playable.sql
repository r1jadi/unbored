-- Whittle joins the catalogue, playable.
--
-- `20261224120000_whittle_sessions.sql` creates the verifier and adds the
-- (`whittle`, `whittle@1`) row to the runtime registry; this migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply `20261224120000_whittle_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `whittle@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'whittle',
  'Whittle',
  'Cross numbers out until every sum fits.',
  'A 5×5 grid of numbers with a target beside every row and under every column. Cross numbers out until what is left in each row and each column adds up to its target. The numbers get bigger as you go, and a quick solve earns a speed bonus.',
  'Tap a number to cross it out; tap again to circle it as one to keep, and once more to clear it. A target lights up when its row or column adds up to it. Every solved board scores 500 points. Beat a board''s par time for a speed bonus of up to double, and end the run whenever you like.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'whittle', now()
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
     where slug = 'whittle' and playable and runtime = 'whittle' and status = 'published'
  ) then
    raise exception 'whittle is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork', 'whittle'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
