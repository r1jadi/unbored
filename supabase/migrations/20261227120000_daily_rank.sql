-- Where a daily run stands among everyone who played the same board.
--
-- The daily games deal one board per day: the session's seed is the day (hashed for
-- 7 Second), so every player with that seed played exactly what this player did.
-- `my_daily_rank` answers, for the caller's own finished run, how many others
-- played that board and how many of them scored lower. Ties are not "beaten".
-- Fewer than two other players answer nothing: a percentage of one is noise.

create or replace function public.my_daily_rank(p_session_id uuid)
returns table (
  players integer,
  beaten  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_game  uuid;
  v_seed  bigint;
  v_score bigint;
  v_others integer;
  v_beaten integer;
begin
  if v_user is null then
    return;
  end if;

  select s.game_id, gs.seed, s.score
    into v_game, v_seed, v_score
    from public.scores s
    join public.game_sessions gs on gs.id = s.session_id
   where s.session_id = p_session_id
     and s.user_id = v_user;
  if not found then
    return;
  end if;

  -- One best score per other player on this board.
  select count(*), count(*) filter (where o.best < v_score)
    into v_others, v_beaten
    from (
      select s.user_id, max(s.score) as best
        from public.scores s
        join public.game_sessions gs on gs.id = s.session_id
       where s.game_id = v_game
         and gs.seed = v_seed
         and s.user_id <> v_user
       group by s.user_id
    ) o;

  if v_others < 2 then
    return;
  end if;
  return query select v_others, v_beaten;
end;
$$;

comment on function public.my_daily_rank(uuid) is
  'For the caller''s own finished run: how many other players played the same board (same game and seed), and how many of them it beat.';

revoke all on function public.my_daily_rank(uuid) from public, anon, authenticated;
grant execute on function public.my_daily_rank(uuid) to authenticated;
