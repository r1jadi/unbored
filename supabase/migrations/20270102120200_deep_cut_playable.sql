-- Deep Cut joins the catalogue, playable.
--
-- `20270102120000_deep_cut_sessions.sql` creates the bank, the per-answer judge and
-- the verifier, and adds (`deep-cut`, `deep-cut@1`) to the runtime registry;
-- `20270102120100_deep_cut_bank.sql` loads the questions. This migration is the
-- other half and lands last, in the same order as every game before it:
--
--   1. apply the sessions and bank migrations — nothing a user can see changes;
--   2. deploy the service that routes `deep-cut@1` completions and serves the
--      question routes, and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'deep-cut',
  'Deep Cut',
  'Name it. The rarer, the better.',
  'Seven questions a day, the same for everyone — "Name a US state", "Name a cheese". Any correct answer scores, but the answers everybody gives stay near the surface: the rarer your answer, the deeper it dives and the more it scores. Ten points for the obvious, a hundred for the abyss.',
  'Each question gives you 25 seconds and one answer. Type anything correct — spelling slips, abbreviations and other names are fine. A correct answer scores by how rarely people give it: Surface 10, Shallows 20, Reef 40, Twilight 60, Midnight 80, Abyss 100, so 700 is a perfect day. A wrong answer, or none, scores nothing. One ranked play a day; new questions at midnight, your time. Unlimited and the archive are there for practice.',
  (select c.id from public.categories c where c.slug = 'daily'),
  'published', true, true, 'deep-cut', now()
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
      published_at = coalesce(public.games.published_at, excluded.published_at);

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'deep-cut' and playable and runtime = 'deep-cut' and status = 'published'
  ) then
    raise exception 'deep-cut is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox', 'minefield',
       'sumdoku', 'guesswork', 'whittle', 'flipside', 'deep-cut'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
