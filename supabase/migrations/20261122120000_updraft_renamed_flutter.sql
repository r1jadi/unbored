-- Updraft is renamed Flutter.
--
-- Only the title players see changes. The slug, the runtime and the rules
-- version stay `updraft`, `updraft` and `updraft@1`: they are identifiers, not
-- names, and changing them would break links, sessions and every recorded
-- score. Safe to apply at any time and to re-run.

update public.games
   set title = 'Flutter'
 where slug = 'updraft';
