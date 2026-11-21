-- Alibi joins the catalogue, playable.
--
-- `20270122120000_alibi_sessions.sql` creates the verifier and adds its row to the
-- runtime registry, and `20270122120100_alibi_start.sql` seeds its sessions by the
-- player's day. This migration is the other half and lands last, in the same order
-- as every game before it:
--
--   1. apply the sessions and start migrations — nothing a user can see changes;
--   2. deploy the service that routes `alibi@1` completions to the new verifier,
--      and the client that plays it;
--   3. apply this migration.
--
-- The text is English; the client shows it in Albanian (`lib/i18n/sq-alibi.ts`).

insert into public.games (
  slug, title, tagline, description, instructions, category_id,
  status, is_official, playable, runtime, published_at, difficulty
)
values
  (
    'alibi',
    'Alibi',
    'One of them is lying. Prove it.',
    'A small mystery every day. Three suspects tell you where they were, and the evidence waits in closed files: a till log, a text message, a receipt, a sign on a wall. One statement doesn''t fit the evidence. Find the lie, and the file that proves it.',
    'Read what each suspect says, then open the files you need; every file opened costs 80 points. To accuse, pick the suspect who is lying and the file that proves it. A first-try solve with only the proof open is worth 920; a wrong accusation costs 300, and a second one closes the case. One ranked case a day; a new one arrives at midnight, your time.',
    (select c.id from public.categories c where c.slug = 'daily'),
    'published', true, true, 'alibi', now(), 2
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
      published_at = coalesce(public.games.published_at, excluded.published_at);

do $$
begin
  if not exists (
    select 1 from public.games
     where slug = 'alibi' and runtime = 'alibi' and playable and status = 'published'
  ) then
    raise exception 'Alibi is not playable after the insert';
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
       'then-and-now', 'honeycomb', 'meander', 'dead-reckoning', 'alibi'
     )
       and is_official
       and (playable or runtime is not null)
  ) then
    raise exception 'an official game other than the shipped runtimes is playable';
  end if;
end
$$;
