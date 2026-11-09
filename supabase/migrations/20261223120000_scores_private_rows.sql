-- Score rows are the player's own; everyone else gets them through functions.
--
-- `scores` was readable row by row to any visitor holding the publishable key,
-- which every visitor does. That went around three choices a player can make:
--
--   * `show_profile_scores = false` — "don't show my scores on my profile";
--   * `show_recently_played = false` / a private account — "don't show what I
--     played and when" (`created_at` on a score row is exactly that);
--   * `show_on_leaderboards = false` — "leave me off the boards".
--
-- Each is honoured by the function that answers for it (`profile_showcase`,
-- `game_leaderboard`, `overall_leaderboard`, the standings), but a direct
-- `GET /rest/v1/scores?user_id=eq.<anyone>` returned every row regardless, and a
-- player the owner had blocked could read them the same way.
--
-- Nothing public needs the table itself. The boards, the standings, the
-- showcase, achievements and trending are `security definer` functions that
-- apply the rules above; `game_stats` is an owner-rights view that only counts.
-- The browser reads `scores` in exactly one way — the signed-in player's own
-- rows — and that keeps working.
--
-- So: a signed-in player reads their own rows, staff read all (moderation), and
-- nobody else reads any. The `anon` grant stays so a caller-rights function that
-- mentions the table answers "no rows" for a visitor instead of raising.
--
-- APPLY ORDER: independent of the client. Every released client already reads
-- only its own rows from this table.

drop policy if exists scores_select_visible on public.scores;
drop policy if exists scores_select_own on public.scores;

create policy scores_select_own
  on public.scores for select to authenticated
  using (user_id = (select auth.uid()) or public.is_staff());

comment on policy scores_select_own on public.scores is
  'A player reads their own score rows; staff read all. Public reads go through the leaderboard and profile functions, which apply the player''s privacy choices.';
