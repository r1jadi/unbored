-- Sumdoku joins the catalogue, playable.
--
-- `20261221120000_sumdoku_sessions.sql` creates the verifier and adds the
-- (`sumdoku`, `sumdoku@1`) row to the runtime registry; this migration is the other
-- half and lands last, in the same order as every game before it:
--
--   1. apply `20261221120000_sumdoku_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `sumdoku@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.
--
-- Guesswork shipped in the same change, and a database can reach this migration
-- with Guesswork already in the catalogue (its migration applied first), so the
-- guard below allows it too.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'sumdoku',
  'Sumdoku',
  'Sudoku where the sums are the clues.',
  'A 6×6 Sudoku with cages: dashed outlines whose digits must add up to the small total in their corner. Early boards give a few digits away; later ones give you nothing but the sums. Every board has exactly one solution, and a quick solve earns a speed bonus.',
  'Fill the grid so every row, column and 2×3 box holds 1 to 6 once each. The digits in each dashed cage add up to its total, and never repeat inside it. Pick a cell and tap a number; Notes jots candidates, Undo steps back. Every solved board scores 60 points. Beat a board''s par time for a speed bonus of up to double, and end the run whenever you like.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'sumdoku', now()
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
     where slug = 'sumdoku' and playable and runtime = 'sumdoku' and status = 'published'
  ) then
    raise exception 'sumdoku is not playable after the insert: its runtime is not the one this migration sets';
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
    raise exception 'an official game other than the shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
