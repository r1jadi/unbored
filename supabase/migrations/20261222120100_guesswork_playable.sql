-- Guesswork joins the catalogue, playable.
--
-- `20261222120000_guesswork_sessions.sql` creates the verifiers, adds the
-- (`guesswork`, `guesswork@1`) and (`guesswork`, `gjeje@1`) rows to the runtime
-- registry and seeds a Guesswork session by the player's day; this migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply `20261222120000_guesswork_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `guesswork@1` and `gjeje@1` completions to the
--      new verifiers and the client that plays the game;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian (`lib/i18n/sq-content.ts`),
-- where the game is Gjeje.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'guesswork',
  'Guesswork',
  'One hidden word a day. Six tries.',
  'Find the day''s five-letter word in six guesses. Every guess shows which letters are in the right place, which are in the word somewhere else, and which are not in it at all. The same word for everyone, in English or, in Albanian, as Gjeje.',
  'Type a five-letter word and press Enter. Each letter is marked: filled for the right place, outlined for in the word but elsewhere, faded for not in the word. Every guess must be a real word from the list. Solve it in fewer guesses for more points: 600 on the first guess down to 100 on the sixth. One ranked play a day; a new word arrives at midnight, your time.',
  (select c.id from public.categories c where c.slug = 'word'),
  'published', true, true, 'guesswork', now()
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
     where slug = 'guesswork' and playable and runtime = 'guesswork' and status = 'published'
  ) then
    raise exception 'guesswork is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twenty-six shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
