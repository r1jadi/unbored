-- Then & Now and Honeycomb join the catalogue, playable.
--
-- `20270106120000` and `20270106120100` create the two verifiers and add their rows
-- to the runtime registry, and `20270106120200_then_and_now_honeycomb_start.sql`
-- seeds their sessions by the player's day. This migration is the other half and lands
-- last, in the same order as every game before it:
--
--   1. apply the sessions and start migrations — nothing a user can see changes;
--   2. deploy the service that routes `then-and-now@1` and `honeycomb@1` completions to
--      the new verifiers, and the client that plays them;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian (`lib/i18n/sq-then-and-now-honeycomb.ts`).

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
values
  (
    'then-and-now',
    'Then & Now',
    'Six events. Put them in order.',
    'One theme a day — inventions, space, music, sport, the ancient world — and six events from it, shuffled. Swap them into the order they happened. Every event in its right place locks in and shows its year.',
    'Tap two events to swap them, oldest at the top, then submit your order. Events in their right place lock in green; you have four tries to get all six. Each event in place is worth 100, and getting all six adds 200 for every try left: 1,200 first time. One ranked play a day; a new timeline arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'daily'),
    'published', true, true, 'then-and-now', now()
  ),
  (
    'honeycomb',
    'Honeycomb',
    'Seven letters. How many words?',
    'Seven letters on a honeycomb, the same for everyone, and every word they make. Each word needs the centre letter, and every day hides at least one word that uses all seven.',
    'Tap letters or type to make words of four letters or more, always with the centre letter; letters can repeat. A four-letter word is worth 10, a longer one 10 a letter, and a word using all seven letters 70 more. Climb from Egg to Royal, and stop whenever you like. One ranked hive a day; new letters at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'word'),
    'published', true, true, 'honeycomb', now()
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
     where (slug, runtime) in (('then-and-now', 'then-and-now'), ('honeycomb', 'honeycomb'))
       and playable and status = 'published'
  ) <> 2 then
    raise exception 'Then & Now and Honeycomb are not both playable after the insert';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork', 'whittle', 'flipside', 'deep-cut',
       'ton-up', 'ballpark', 'only-once', 'tee-time', 'foursort', 'pixelock',
       'then-and-now', 'honeycomb'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable';
  end if;
end
$$;
