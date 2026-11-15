-- Ton Up, Ballpark, Only Once and Tee Time join the catalogue, playable.
--
-- `20270104120000` to `20270104120300` create the four verifiers and add their
-- rows to the runtime registry, and `20270104120400_daily_four_start.sql` seeds
-- their sessions by the player's day. This migration is the other half and lands
-- last, in the same order as every game before it:
--
--   1. apply the sessions and start migrations — nothing a user can see changes;
--   2. deploy the service that routes `ton-up@1`, `ballpark@1`, `only-once@1` and
--      `tee-time@1` completions to the new verifiers, and the client that plays
--      them;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian (`lib/i18n/sq-content.ts`).

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
values
  (
    'ton-up',
    'Ton Up',
    'Three darts. Hit exactly 100.',
    'One category a day — chemical elements, US presidents, calling codes — and every answer is worth a number: an element its atomic number, a president their number in office. Name up to three answers to add up to exactly 100. Go over and you bust.',
    'Type an answer and pick it from the list: its number is added to your total. Up to three darts, each answer once, and you can stand whenever you like. Over 100 is a bust and scores nothing. Your score is your total; exactly 100 is a ton, worth 1,250 in three darts, 1,500 in two and 1,750 in one. One ranked play a day; a new category arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'daily'),
    'published', true, true, 'ton-up', now()
  ),
  (
    'ballpark',
    'Ballpark',
    'Guess the price. Six tries.',
    'One product a day, the same for everyone, and six guesses at what it costs on a typical US shelf. Every guess tells you higher or lower, and whether you are close. Land within 5% to win.',
    'Type a price and press Guess. An arrow says whether the real price is higher or lower; amber means you are within 25%. Get within 5% to win: 600 for the first guess, down to 100 on the sixth. One ranked play a day; a new product arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'daily'),
    'published', true, true, 'ballpark', now()
  ),
  (
    'only-once',
    'Only Once',
    'Seven questions. Never the same answer twice.',
    'Seven questions a day about one kind of thing — countries, US states or chemical elements. The same answers fit question after question, but each one can only be used once: spend the famous one early and you might need it later.',
    'Type an answer and pick it from the list. A wrong answer, or one you have already used, is turned down and you can try again — only the clock ends your day, 25 seconds a question. Each question answered is worth 100, and all seven make 1,000. One ranked play a day; new questions at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'daily'),
    'published', true, true, 'only-once', now()
  ),
  (
    'tee-time',
    'Tee Time',
    'A new nine holes every day.',
    'A daily nine-hole golf course, built from the date and the same for everyone: fairways that bend, bunkers round the greens, water now and then and a wind on every hole. Pick a club, set your line, and stop the swing meter.',
    'Tap the course to aim, then tap Swing and tap again to stop the power meter. Reach the green and the putts are automatic: inside the inner ring one putt, the outer ring two, anywhere else three. Water and out of bounds cost a stroke. Every hole scores (par + 3 − strokes) × 100, so a par is 300 and a birdie 400. One ranked round a day; a new course at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'arcade'),
    'published', true, true, 'tee-time', now()
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
     where (slug, runtime) in (('ton-up', 'ton-up'), ('ballpark', 'ballpark'),
                               ('only-once', 'only-once'), ('tee-time', 'tee-time'))
       and playable and status = 'published'
  ) <> 4 then
    raise exception 'the four daily games are not all playable after the insert';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork', 'whittle', 'flipside', 'deep-cut',
       'ton-up', 'ballpark', 'only-once', 'tee-time'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable';
  end if;
end
$$;
