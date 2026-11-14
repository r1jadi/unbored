-- Deep Cut: a question stays out of the daily set for longer as the bank grows.
--
-- A day's seven questions leave out the questions used in the days just before.
-- That window was capped at six days, so even a large bank could deal a question
-- again a week later. It now grows with the bank — one day per seven active
-- questions, less one, so there are always seven left to deal — up to 60 days:
-- 100 questions keep a question out for 13 days.
--
-- Days already chosen keep their questions (`deep_cut_days` is written once).

create or replace function public.deep_cut_repeat_window()
returns integer
language sql
stable
set search_path = ''
as $$
  select least(60, greatest(0, count(*)::integer / 7 - 1))
    from public.deep_cut_questions q where q.active
$$;

revoke all on function public.deep_cut_repeat_window() from public;

comment on function public.deep_cut_repeat_window() is
  'How many days before a Deep Cut day its questions must not have been dealt: one per seven active questions, less one, at most 60.';

create or replace function public.deep_cut_day_questions(p_day integer)
returns smallint[]
language plpgsql
set search_path = ''
as $$
declare
  v_ids    smallint[];
  v_recent smallint[];
  v_pool   smallint[];
  v_window integer;
begin
  select d.question_ids into v_ids from public.deep_cut_days d where d.day = p_day;
  if found then
    return v_ids;
  end if;

  v_window := public.deep_cut_repeat_window();

  select coalesce(array_agg(distinct q), '{}') into v_recent
    from public.deep_cut_days d, unnest(d.question_ids) q
   where d.day between p_day - v_window and p_day - 1;

  select coalesce(array_agg(q.id order by q.id), '{}') into v_pool
    from public.deep_cut_questions q
   where q.active and not (q.id = any(v_recent));

  if coalesce(array_length(v_pool, 1), 0) < 7 then
    select coalesce(array_agg(q.id order by q.id), '{}') into v_pool
      from public.deep_cut_questions q
     where q.active;
  end if;

  if coalesce(array_length(v_pool, 1), 0) < 7 then
    raise exception 'the Deep Cut bank has fewer than seven active questions' using errcode = 'P0001';
  end if;

  v_ids := public.deep_cut_shuffle(v_pool, p_day::bigint * 2654435761 + 97, 7);

  insert into public.deep_cut_days (day, question_ids) values (p_day, v_ids)
  on conflict (day) do nothing;

  select d.question_ids into v_ids from public.deep_cut_days d where d.day = p_day;
  return v_ids;
end;
$$;

revoke all on function public.deep_cut_day_questions(integer) from public;
