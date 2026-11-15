-- Foursort and Pixelock join the catalogue, playable.
--
-- `20270105120000` and `20270105120100` create the two verifiers and add their rows
-- to the runtime registry, and `20270105120200_foursort_pixelock_start.sql` seeds
-- their sessions by the player's day. This migration is the other half and lands
-- last, in the same order as every game before it:
--
--   1. apply the sessions and start migrations — nothing a user can see changes;
--   2. deploy the service that routes `foursort@1` and `pixelock@1` completions to
--      the new verifiers, and the client that plays them;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian (`lib/i18n/sq-foursort-pixelock.ts`).

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
values
  (
    'foursort',
    'Foursort',
    'Sixteen words. Four hidden groups.',
    'Sixteen words a day, the same for everyone, hiding four groups of four: things they have in common, from the obvious to the sneaky. Some words fit more than one group, but only one way sorts them all.',
    'Pick four words and press Submit. Right, and the group is locked in with its link; wrong costs one of four mistakes, and three of the four right tells you you''re one away. Each group is worth 150, and finding all four adds 100 for every mistake left: 1,000 for a perfect day. One ranked play a day; a new set arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'word'),
    'published', true, true, 'foursort', now()
  ),
  (
    'pixelock',
    'Pixelock',
    'Crack the clues. Draw the picture.',
    'A 10 × 10 grid with a number clue on every row and column, and one hidden picture a day. Work out which cells the clues force, fill them in, and the drawing appears. Every picture can be solved without guessing.',
    'The numbers by a line are its runs of filled cells, in order. Pick Fill or Cross out and tap a cell, or drag along a line. A wrong cell costs one of three lives and shows what it really is. Every cell you fill is worth 10, and finishing the picture adds 500 and 250 for every life left. One ranked play a day; a new picture arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'logic'),
    'published', true, true, 'pixelock', now()
  )
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
  if (
    select count(*) from public.games
     where (slug, runtime) in (('foursort', 'foursort'), ('pixelock', 'pixelock'))
       and playable and status = 'published'
  ) <> 2 then
    raise exception 'Foursort and Pixelock are not both playable after the insert';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork', 'whittle', 'flipside', 'deep-cut',
       'ton-up', 'ballpark', 'only-once', 'tee-time', 'foursort', 'pixelock'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable';
  end if;
end
$$;
