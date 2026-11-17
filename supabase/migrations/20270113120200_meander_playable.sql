-- Meander joins the catalogue, playable.
--
-- `20270113120000_meander_sessions.sql` creates the verifier and adds its row to
-- the runtime registry, and `20270113120100_meander_start.sql` seeds its sessions by
-- the player's day. This migration is the other half and lands last, in the same
-- order as every game before it:
--
--   1. apply the sessions and start migrations — nothing a user can see changes;
--   2. deploy the service that routes `meander@1` completions to the new verifier,
--      and the client that plays it;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian (`lib/i18n/sq-meander.ts`).

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at, difficulty
)
values
  (
    'meander',
    'Meander',
    'Hidden words wind through the grid.',
    'One theme a day and a 5 × 5 grid of letters hiding four or five words from it. Every word winds through side-by-side letters, turning as it goes, and together they use every letter exactly once. You only know the theme and how long each word is.',
    'Drag through neighbouring letters (up, down, left or right) to trace a word. If it is one of the day''s, it stays on the grid. A word can often be traced more than one way, and the wrong route strands letters another word needs: tap a placed word to lift it. Each word is worth 100, and filling the grid adds 500 and 250 for every hint you didn''t take: 1,750 for a clean five-word day. One ranked play a day; a new grid arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'word'),
    'published', true, true, 'meander', now(), 2
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
     where slug = 'meander' and runtime = 'meander' and playable and status = 'published'
  ) then
    raise exception 'Meander is not playable after the insert';
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
       'then-and-now', 'honeycomb', 'meander'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable';
  end if;
end
$$;
