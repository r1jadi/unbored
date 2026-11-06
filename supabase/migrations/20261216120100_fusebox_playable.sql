-- Fusebox joins the catalogue, playable.
--
-- `20261216120000_fusebox_sessions.sql` creates the verifier and adds the
-- (`fusebox`, `fusebox@1`) row to the runtime registry; this migration is the other
-- half and lands last, in the same order as every game before it:
--
--   1. apply `20261216120000_fusebox_sessions.sql` — nothing a user can see changes;
--   2. deploy the service that routes `fusebox@1` completions to the new verifier
--      and the client that plays the game;
--   3. apply this migration.

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at
)
select
  'fusebox',
  'Fusebox',
  'One tap. One chain reaction.',
  'A grid of charged cells, one spark at a time. Pop a cell and its bolts charge the next ones, and the next, in waves worth more each time. Long chains pay your sparks back, so a run is always one good tap from turning around.',
  'Tap a cell to spend a spark and add one charge. At four charge it pops and fires a bolt each way, up to three cells, charging the first charged cell it meets. Each wave of a chain scores more than the last. Four pops from one tap gives back a spark, seven gives two, eleven gives three, and leaving four charged cells or fewer clears the board for three more. Every second board asks for longer chains. Surge cells fire diagonally too from board three; a shielded cell''s first hit only breaks its shield from board five. The run ends when the sparks run out.',
  (select c.id from public.categories c where c.slug = 'puzzle'),
  'published', true, true, 'fusebox', now()
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
     where slug = 'fusebox' and playable and runtime = 'fusebox' and status = 'published'
  ) then
    raise exception 'fusebox is not playable after the insert: its runtime is not the one this migration sets';
  end if;

  if exists (
    select 1 from public.games
     where slug not in (
       'stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move',
       'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle',
       'sun-and-moon', 'sudoku', 'crossword', 'gridburst', 'updraft', 'decant', 'mini-sudoku',
       'scatter', 'huedini', 'cascade', 'checkmate', 'bolted', 'fusebox'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the twenty-three shipped runtimes is playable: runtimes ship one game at a time';
  end if;
end
$$;
