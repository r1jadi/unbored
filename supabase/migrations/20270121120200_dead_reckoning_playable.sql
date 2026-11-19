-- Dead Reckoning joins the catalogue, playable.
--
-- `20270121120000_dead_reckoning_sessions.sql` creates the verifier and adds its row
-- to the runtime registry, and `20270121120100_dead_reckoning_start.sql` seeds its
-- sessions by the player's day. This migration is the other half and lands last,
-- in the same order as every game before it:
--
--   1. apply the sessions and start migrations — nothing a user can see changes;
--   2. deploy the service that routes `dead-reckoning@1` completions to the new
--      verifier, and the client that plays it;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian
-- (`lib/i18n/sq-dead-reckoning.ts`).

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at, difficulty
)
values
  (
    'dead-reckoning',
    'Dead Reckoning',
    'Seven numbers. Get as close as you can.',
    'Seven fast rounds a day, thirty seconds each. Every round gives you a number: name a mountain, a river, a building, a famous person or a country whose real value is closest to it, or estimate the answer yourself. The nearer you land, the higher your plane climbs, but it sinks while the clock runs, so be quick as well as close.',
    'Type an answer and pick it from the suggestions, or type your estimate, and submit before the clock runs out. Every answer is rated from Miss to Dialed (within 1%), worth up to 1,000, and the points drain as the clock runs: answer at once for all of them, at the buzzer for 40%. One round a day is golden and counts double. One ranked play a day; seven new rounds arrive at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'daily'),
    'published', true, true, 'dead-reckoning', now(), 2
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
      difficulty   = excluded.difficulty,
      -- A re-run keeps the original publication date.
      published_at = coalesce(public.games.published_at, excluded.published_at);

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'dead-reckoning' and runtime = 'dead-reckoning' and playable
       and status = 'published'
  ) then
    raise exception 'Dead Reckoning is not playable after the insert';
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
       'then-and-now', 'honeycomb', 'meander', 'dead-reckoning'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable';
  end if;
end
$$;
