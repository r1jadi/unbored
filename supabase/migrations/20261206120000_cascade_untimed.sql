-- Cascade no longer has a clock.
--
-- `complete_cascade_run` rejects a run as `out_of_time` when it arrives later than
-- `cascade_budget_ms(levels) + cascade_slack_ms()` after the session started. The
-- game is untimed now, so the budget is a day: long enough that the check never
-- fires for a real run, while the verifier itself (and its other checks, such as
-- `invalid_duration`) stays unchanged.

create or replace function public.cascade_budget_ms(p_cleared integer)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select 86400000::bigint;
$$;

comment on function public.cascade_budget_ms(integer) is
  'Cascade is untimed: the budget is a day, so a run is never out_of_time in practice.';
