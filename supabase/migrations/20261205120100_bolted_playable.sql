-- Bolted joins the catalogue, playable.
--
-- `20261205120000_bolted_sessions.sql` creates the verifier and adds the
-- (`bolted`, `bolted@1`) row to the runtime registry; this migration is the other half
-- and lands last, in the same order as every game before it:
--
--   1. apply `20261205120000_bolted_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `bolted@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'bolted',
  'Bolted',
  'Sort the nuts. Lock every bolt.',
  'The nut-and-bolt sorting puzzle: move coloured nuts between bolts until each bolt holds one colour. A full bolt locks for good, and from the third board the nuts start face down, so every move can turn up a surprise. Every sorted board winds the clock back.',
  'Tap a bolt, then another, to move its top nut there, along with every nut of the same colour right under it, as many as fit. A nut lands on an empty bolt or on the same colour. A bolt with four nuts of one colour locks. Sort every bolt for 10 points a colour and more time; boards gain a colour every second board, up to eight, and from board three the lower nuts start hidden. Stuck? Undo, restart the board, or add one empty bolt for 15 seconds of clock. The clock starts at 1:15 and the run ends when it runs out.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'bolted', now()
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
     where slug = 'bolted' and playable and runtime = 'bolted' and status = 'published'
  ) then
    raise exception 'bolted is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twenty-two shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
