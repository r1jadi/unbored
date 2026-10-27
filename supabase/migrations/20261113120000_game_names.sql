-- Three games get names of their own: Queens becomes Crowns, Zip becomes Trail
-- and Tango becomes Sun & Moon.
--
-- Only what a player sees changes: the slug (and so the URLs), the title and the
-- catalogue copy. A game is matched by its `runtime`, which stays `queens`,
-- `zip` and `tango`, as do the rules versions (`queens@1`, `zip@1`, `tango@1`),
-- the verifiers and every recorded session and score: those hang off the game's
-- id, never its slug. `start_game_session` gates on the runtime, so the new slugs
-- play at once.
--
-- Safe in either order with the client deploy: the client links to whatever slug
-- the catalogue returns, and `vercel.json` redirects the old URLs to the new ones.

update public.games
   set slug         = 'crowns',
       title        = 'Crowns',
       tagline      = 'One crown per row, column and colour.',
       description  = 'Place a crown in every row, column and colour region, with no two touching. Every board has one solution, and the boards keep coming.',
       instructions = 'Every board is split into coloured regions. Place exactly one crown in each row, each column and each region; two crowns can never touch, not even diagonally. Tap a cell once for an X, twice for a crown, and a third time to clear it. A crown off the solution is a mistake, and the third mistake ends the run. Each solved board is worth ten points a row, the boards grow from 5×5 to 9×9, and you can end the run whenever you like.',
       updated_at   = now()
 where runtime = 'queens' and is_official;

update public.games
   set slug       = 'trail',
       title      = 'Trail',
       updated_at = now()
 where runtime = 'zip' and is_official;

update public.games
   set slug       = 'sun-and-moon',
       title      = 'Sun & Moon',
       updated_at = now()
 where runtime = 'tango' and is_official;

do $$
begin
  if exists (
    select 1 from public.games
     where slug in ('queens', 'zip', 'tango') and is_official
  ) then
    raise exception 'an official game still uses an old slug';
  end if;
end
$$;
