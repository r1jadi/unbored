-- Deep Cut: check an answer before it counts, and the staff review queue.
--
-- 1. `deep_cut_check` tells a player whether what they typed is a valid answer
--    *before* they submit it, so a typo or a wrong answer can be fixed while the
--    clock runs instead of costing the question. It says only valid / not valid —
--    never the tier, never the bank's spelling — and records nothing: the turn
--    stays open. A spelling nobody has judged is answered `unknown`; the service
--    then asks the AI judge (`deep_cut_check_context` + `deep_cut_record_review`,
--    the same cached ruling a submitted answer gets) and checks again.
--
--    An answer that doesn't count comes with up to two suggestions of what the
--    player may have meant (`deep_cut_suggest`).
--
-- 2. The admin console's Deep Cut queue: every judged and pending spelling
--    (`admin_deep_cut_reviews`), a question's answers (`admin_deep_cut_answers`),
--    a ruling (`admin_deep_cut_rule`, staff's `deep_cut_staff_review` behind the
--    staff guard) and a re-tier (`admin_deep_cut_set_tier`). Each has a `_svc`
--    twin for the allowlisted-administrator bridge, like every admin call.
--
-- 3. Tiers are estimates; the queue shows what players actually say. Each
--    answer comes with its share of every answer given to its question and the
--    tier that share suggests (`deep_cut_tier_for_share`), once there are 100.
--
-- 4. A tier staff set by hand survives the next bank load: a re-tiered answer is
--    marked `staff`, and `deep_cut_load_question` no longer overwrites it.
--
-- Safe in either order with the app deploy: without it the check route answers
-- `unknown` errors (the client then submits as before) and the admin page errors.

-- ─────────────────────────────────────────────────────────────────────────────
-- Suggesting an answer
-- ─────────────────────────────────────────────────────────────────────────────

-- Up to two of a question's answers that look like what the player meant, for an
-- answer that doesn't count: one sharing a word with it ("New York City" → New
-- York), one it is the start of or starts with ("Califor" → California,
-- "Rhode Island Red" → Rhode Island), or a spelling just beyond the typo
-- allowance ("Missisipi" → Mississippi). Most-shared first, then the commonest.
--
-- So it can't be used to fish for rare answers, a word that appears in three or
-- more of the question's answers ("new", "south", "island") counts for nothing,
-- nor does a word under three letters or a filler word; a bare prefix must be
-- five letters and name exactly one answer; and the common answers come first.
create or replace function public.deep_cut_suggest(p_question_id smallint, p_raw text)
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key    text := public.deep_cut_key(p_raw);
  v_allow  integer;
  v_result text[];
begin
  if v_key is null or v_key = '' then
    return '{}';
  end if;
  v_allow := public.deep_cut_typo_allowance(v_key) + 1;

  with typed as (
    select distinct public.deep_cut_key(w) as word
      from regexp_split_to_table(lower(coalesce(p_raw, '')), '[^[:alnum:]]+') w
  ), answer_words as (
    select a.id, public.deep_cut_key(w) as word
      from public.deep_cut_answers a,
           regexp_split_to_table(lower(a.canonical), '[^[:alnum:]]+') w
     where a.question_id = p_question_id
  ), useful as (
    select t.word
      from typed t
     where char_length(t.word) >= 3
       and t.word not in ('the', 'and', 'of', 'de', 'la', 'le', 'el', 'del', 'des', 'von', 'van',
                          'saint', 'st', 'san', 'santa', 'mount', 'lake', 'river', 'great')
       and (select count(distinct aw.id) from answer_words aw where aw.word = t.word) between 1 and 2
  ), shared as (
    select aw.id, count(distinct aw.word)::integer as score
      from answer_words aw
      join useful u on u.word = aw.word
     group by aw.id
  ), prefixed as (
    -- What was typed starts with a whole spelling ("rhodeislandred" → "rhodeisland").
    select distinct s.answer_id as id, 1 as score
      from public.deep_cut_spellings s
     where s.question_id = p_question_id
       and char_length(s.key) >= 5
       and v_key like s.key || '%'
       and v_key <> s.key
    union
    -- What was typed is the start of exactly one answer ("califor" → California).
    select min(s.answer_id), 1
      from public.deep_cut_spellings s
     where s.question_id = p_question_id
       and char_length(v_key) >= 5
       and s.key like v_key || '%'
     having count(distinct s.answer_id) = 1
  ), near as (
    -- A spelling one typo further than the matcher forgives, same first letter.
    select distinct s.answer_id as id, 1 as score
      from public.deep_cut_spellings s
     where s.question_id = p_question_id
       and char_length(v_key) >= 5
       and char_length(s.key) >= 5
       and left(s.key, 1) = left(v_key, 1)
       and abs(char_length(s.key) - char_length(v_key)) <= v_allow
       and public.deep_cut_distance(v_key, s.key, v_allow) <= v_allow
  ), candidates as (
    select c.id, max(c.score) as score
      from (select * from shared union all select * from prefixed union all select * from near) c
     where c.id is not null
     group by c.id
  )
  select coalesce(array_agg(x.canonical order by x.score desc, x.tier, x.canonical), '{}')
    into v_result
    from (
      select a.canonical, a.tier, c.score
        from candidates c
        join public.deep_cut_answers a on a.id = c.id
       order by c.score desc, a.tier, a.canonical
       limit 2
    ) x;
  return v_result;
end;
$$;

revoke all on function public.deep_cut_suggest(smallint, text) from public;

comment on function public.deep_cut_suggest(smallint, text) is
  'Up to two answers a Deep Cut answer that does not count may have meant: a shared uncommon word, a prefix, or a near spelling. Commonest first; never more than two.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Checking an answer
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.deep_cut_check(
  p_run_id   uuid,
  p_position integer,
  p_answer   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run    public.deep_cut_runs;
  v_state  text;
  v_turn   public.deep_cut_turns;
  v_raw    text := nullif(btrim(regexp_replace(coalesce(p_answer, ''), '\s+', ' ', 'g')), '');
  v_key    text;
  v_lookup record;
  v_result text;
begin
  if p_position is null or p_position < 0 or p_position >= public.deep_cut_questions_per_run() then
    return jsonb_build_object('outcome', 'invalid_position');
  end if;
  if v_raw is not null and char_length(v_raw) > 60 then
    return jsonb_build_object('outcome', 'invalid_answer');
  end if;

  v_run := public.deep_cut_claim_run(p_run_id);
  if v_run.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  v_state := public.deep_cut_run_state(v_run);
  if v_state <> 'live' then
    return jsonb_build_object('outcome', v_state);
  end if;

  select * into v_turn from public.deep_cut_turns t
   where t.run_id = v_run.id and t.position = p_position;
  if not found then
    return jsonb_build_object('outcome', 'not_shown');
  end if;
  if v_turn.submitted_at is not null or v_turn.verdict is not null then
    return jsonb_build_object('outcome', 'already_answered');
  end if;
  -- Only while the question's own clock runs: the check is a help for the
  -- answer being typed, not a way to probe the bank afterwards.
  if now() > v_turn.shown_at
       + make_interval(secs => public.deep_cut_answer_seconds() + public.deep_cut_grace_seconds()) then
    return jsonb_build_object('outcome', 'checked', 'result', 'late');
  end if;

  v_key := public.deep_cut_key(v_raw);
  if v_raw is null or v_key = '' then
    return jsonb_build_object('outcome', 'checked', 'result', 'empty');
  end if;

  select * into v_lookup from public.deep_cut_lookup(v_turn.question_id, v_key);
  v_result := case
    when v_lookup.answer_id is not null then 'valid'
    when v_lookup.kind = 'rejected' then 'invalid'
    when v_lookup.kind = 'ambiguous' then 'ambiguous'
    else 'unknown'
  end;
  if v_result = 'valid' then
    return jsonb_build_object('outcome', 'checked', 'result', v_result);
  end if;
  return jsonb_build_object('outcome', 'checked', 'result', v_result,
    'suggestions', to_jsonb(public.deep_cut_suggest(v_turn.question_id, v_raw)));
end;
$$;

comment on function public.deep_cut_check(uuid, integer, text) is
  'Whether a Deep Cut answer would count, before it is submitted: valid, invalid, ambiguous (close to two answers), unknown (never judged), empty or late; an answer that does not count comes with up to two suggestions. Records nothing and never reveals a tier.';

revoke all on function public.deep_cut_check(uuid, integer, text) from public;
grant execute on function public.deep_cut_check(uuid, integer, text) to anon, authenticated;

-- What the AI judge needs to rule on an answer being checked: the open turn's
-- question, the bank's answers, and the answer's key. Judge key only.
create or replace function public.deep_cut_check_context(
  p_judge_key text,
  p_run_id    uuid,
  p_position  integer,
  p_answer    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turn     public.deep_cut_turns;
  v_question public.deep_cut_questions;
  v_raw      text := nullif(btrim(regexp_replace(coalesce(p_answer, ''), '\s+', ' ', 'g')), '');
  v_key      text;
begin
  if not public.deep_cut_judge_allowed(p_judge_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_key := public.deep_cut_key(v_raw);
  if v_raw is null or v_key = '' or char_length(v_raw) > 60 then
    return jsonb_build_object('outcome', 'not_open');
  end if;
  select t.* into v_turn from public.deep_cut_turns t
    join public.deep_cut_runs r on r.id = t.run_id
   where (r.id = p_run_id or r.session_id = p_run_id) and t.position = p_position;
  if not found or v_turn.submitted_at is not null or v_turn.verdict is not null then
    return jsonb_build_object('outcome', 'not_open');
  end if;
  select * into v_question from public.deep_cut_questions q where q.id = v_turn.question_id;
  return jsonb_build_object(
    'outcome', 'held',
    'questionId', v_question.id,
    'prompt', v_question.prompt,
    'category', v_question.category,
    'answer', v_raw,
    'key', v_key,
    'known', (select coalesce(jsonb_agg(a.canonical order by a.tier, a.canonical), '[]'::jsonb)
                from public.deep_cut_answers a where a.question_id = v_question.id)
  );
end;
$$;

revoke all on function public.deep_cut_check_context(text, uuid, integer, text) from public;
grant execute on function public.deep_cut_check_context(text, uuid, integer, text) to anon, authenticated;

comment on function public.deep_cut_check_context(text, uuid, integer, text) is
  'The AI judge''s view of an answer being checked on an open Deep Cut turn. Needs a judge key whose SHA-256 is in deep_cut_judge_keys.';

-- ─────────────────────────────────────────────────────────────────────────────
-- A hand-set tier survives a bank reload
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.deep_cut_load_question(
  p_slug     text,
  p_category text,
  p_prompt   text,
  p_answers  jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_question smallint;
  v_entry    jsonb;
  v_answer   integer;
  v_spelling text;
  v_key      text;
  v_names    text[] := '{}';
begin
  insert into public.deep_cut_questions (slug, category, prompt)
  values (p_slug, p_category, p_prompt)
  on conflict (slug) do update
    set category = excluded.category, prompt = excluded.prompt, active = true
  returning id into v_question;

  for v_entry in select * from jsonb_array_elements(p_answers) loop
    -- An answer staff placed by hand keeps its tier; an AI-added answer the bank
    -- now lists becomes curated at the bank's tier.
    insert into public.deep_cut_answers (question_id, canonical, tier, source)
    values (v_question, v_entry->>'name', (v_entry->>'tier')::smallint, 'curated')
    on conflict (question_id, canonical) do update
      set tier   = case when public.deep_cut_answers.source = 'staff'
                        then public.deep_cut_answers.tier else excluded.tier end,
          source = case when public.deep_cut_answers.source = 'staff'
                        then 'staff' else 'curated' end
    returning id into v_answer;
    v_names := v_names || (v_entry->>'name');

    for v_spelling in
      select v_entry->>'name'
      union all
      select jsonb_array_elements_text(coalesce(v_entry->'aliases', '[]'::jsonb))
    loop
      v_key := public.deep_cut_key(v_spelling);
      if v_key = '' then
        raise exception 'deep cut %: the spelling "%" has no letters', p_slug, v_spelling;
      end if;
      insert into public.deep_cut_spellings (question_id, key, answer_id)
      values (v_question, v_key, v_answer)
      on conflict (question_id, key) do update set answer_id = excluded.answer_id;
    end loop;
  end loop;

  delete from public.deep_cut_answers a
   where a.question_id = v_question
     and a.source = 'curated'
     and not (a.canonical = any(v_names));
end;
$$;

revoke all on function public.deep_cut_load_question(text, text, text, jsonb) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- The admin console's queue
-- ─────────────────────────────────────────────────────────────────────────────

-- Judged and pending spellings. `p_verdict` null is every verdict; pending rows
-- come most-played first (the ones costing the most players a score), judged
-- rows newest ruling first.
create or replace function public.admin_deep_cut_reviews(
  p_verdict text default 'pending',
  p_search  text default null,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  question_id     integer,
  question_slug   text,
  category        text,
  prompt          text,
  key             text,
  sample          text,
  verdict         text,
  reviewer        text,
  seen            integer,
  first_seen      timestamptz,
  reviewed_at     timestamptz,
  answer_id       integer,
  answer_name     text,
  answer_tier     integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_limit   integer := greatest(1, least(coalesce(p_limit, 50), 101));
  v_offset  integer := greatest(0, coalesce(p_offset, 0));
  v_search  text := nullif(btrim(coalesce(p_search, '')), '');
  v_verdict text := nullif(btrim(coalesce(p_verdict, '')), '');
begin
  perform public.admin_guard_staff();

  if v_verdict is not null and v_verdict not in ('pending', 'accepted', 'rejected') then
    raise exception 'unknown review verdict' using errcode = '22023';
  end if;

  return query
  select
    q.id::integer,
    q.slug,
    q.category,
    q.prompt,
    r.key,
    r.sample,
    r.verdict,
    r.reviewer,
    r.seen,
    r.first_seen,
    r.reviewed_at,
    a.id,
    a.canonical,
    a.tier::integer
  from public.deep_cut_reviews r
  join public.deep_cut_questions q on q.id = r.question_id
  left join public.deep_cut_answers a on a.id = r.answer_id
  where (v_verdict is null or r.verdict = v_verdict)
    and (v_search is null
         or r.sample ilike '%' || v_search || '%'
         or q.prompt ilike '%' || v_search || '%')
  order by
    case when r.verdict = 'pending' then r.seen end desc nulls last,
    coalesce(r.reviewed_at, r.first_seen) desc,
    r.question_id, r.key
  limit v_limit offset v_offset;
end;
$$;

comment on function public.admin_deep_cut_reviews(text, text, integer, integer) is
  'Deep Cut spellings the bank did not know, with their verdict. Requires staff.';

revoke all on function public.admin_deep_cut_reviews(text, text, integer, integer) from public, anon;
grant execute on function public.admin_deep_cut_reviews(text, text, integer, integer) to authenticated;

-- What players actually say, as a tier. A tier estimates the share of players who
-- give an answer; once a question has been answered often enough, each answer's
-- real share suggests its tier:
--
--   Surface ≥ 15% · Shallows ≥ 6% · Reef ≥ 2.5% · Twilight ≥ 1% · Midnight > 0
--
-- and an answer nobody has given in a large sample is an Abyss. Below the sample
-- there is no suggestion: a few plays say little.
create or replace function public.deep_cut_tier_sample()
returns integer language sql immutable set search_path = '' as $$ select 100 $$;

create or replace function public.deep_cut_tier_for_share(p_given bigint, p_total bigint)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_total is null or p_total < public.deep_cut_tier_sample() then null
    when p_given * 100.0 / p_total >= 15 then 1
    when p_given * 100.0 / p_total >= 6 then 2
    when p_given * 100.0 / p_total >= 2.5 then 3
    when p_given * 100.0 / p_total >= 1 then 4
    when p_given > 0 then 5
    when p_total >= 4 * public.deep_cut_tier_sample() then 6
    else null
  end
$$;

revoke all on function public.deep_cut_tier_sample() from public;
revoke all on function public.deep_cut_tier_for_share(bigint, bigint) from public;

-- A question's answers, deepest last, so a reviewer can file a spelling under
-- one of them or re-tier it.
create or replace function public.admin_deep_cut_answers(p_question_id integer)
returns table (
  id             integer,
  canonical      text,
  tier           integer,
  source         text,
  spellings      integer,
  given          bigint,
  share_percent  numeric,
  suggested_tier integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_total bigint;
begin
  perform public.admin_guard_staff();
  -- Every answer given to the question, right or wrong: the share a tier estimates.
  select count(*) into v_total from public.deep_cut_turns t
   where t.question_id = p_question_id::smallint and t.verdict in ('correct', 'wrong', 'unverified');

  return query
  with counted as (
    select a.id, a.canonical, a.tier, a.source,
           (select count(*)::integer from public.deep_cut_spellings s where s.answer_id = a.id) as spellings,
           (select count(*) from public.deep_cut_turns t
             where t.question_id = a.question_id and t.answer_id = a.id and t.verdict = 'correct') as n
      from public.deep_cut_answers a
     where a.question_id = p_question_id::smallint
  )
  select
    g.id,
    g.canonical,
    g.tier::integer,
    g.source,
    g.spellings,
    g.n,
    case when v_total >= public.deep_cut_tier_sample() then round(100.0 * g.n / v_total, 2) end,
    public.deep_cut_tier_for_share(g.n, v_total)
  from counted g
  order by g.tier, g.canonical;
end;
$$;

comment on function public.admin_deep_cut_answers(integer) is
  'One Deep Cut question''s answers with their tier, source, spelling count, how often players gave them, their share of all answers and the tier that share suggests (once the question has 100 answers). Requires staff.';

revoke all on function public.admin_deep_cut_answers(integer) from public, anon;
grant execute on function public.admin_deep_cut_answers(integer) to authenticated;

-- Staff's ruling on a spelling, from the console. Accepting needs a name (an
-- existing answer's, to file it as another spelling, or a new one) and a tier
-- (ignored when the name is an existing answer).
create or replace function public.admin_deep_cut_rule(
  p_question_id integer,
  p_key         text,
  p_verdict     text,
  p_canonical   text default null,
  p_tier        integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous text;
  v_result   text;
begin
  perform public.admin_guard_staff();
  if not exists (select 1 from public.deep_cut_questions q where q.id = p_question_id::smallint) then
    raise exception 'no such question' using errcode = 'P0002';
  end if;
  select r.verdict into v_previous from public.deep_cut_reviews r
   where r.question_id = p_question_id::smallint and r.key = p_key;
  v_result := public.deep_cut_staff_review(p_question_id, p_key, p_verdict, p_canonical, p_tier);
  return jsonb_build_object(
    'questionId', p_question_id,
    'key', p_key,
    'previousVerdict', v_previous,
    'verdict', v_result
  );
end;
$$;

comment on function public.admin_deep_cut_rule(integer, text, text, text, integer) is
  'A staff ruling on a Deep Cut spelling: accepted (as an existing or a new answer) or rejected. Replaces any earlier ruling. Requires staff.';

revoke all on function public.admin_deep_cut_rule(integer, text, text, text, integer) from public, anon;
grant execute on function public.admin_deep_cut_rule(integer, text, text, text, integer) to authenticated;

-- Moves an answer to another tier. The answer is marked `staff` so a later bank
-- load keeps the new tier. Turns already played keep the points they scored.
create or replace function public.admin_deep_cut_set_tier(p_answer_id integer, p_tier integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_previous smallint;
begin
  perform public.admin_guard_staff();
  if p_tier is null or p_tier not between 1 and 6 then
    raise exception 'a tier is 1 to 6' using errcode = '22023';
  end if;
  select a.tier into v_previous from public.deep_cut_answers a where a.id = p_answer_id for update;
  if not found then
    raise exception 'no such answer' using errcode = 'P0002';
  end if;
  update public.deep_cut_answers a
     set tier = p_tier, source = 'staff'
   where a.id = p_answer_id;
  return jsonb_build_object('answerId', p_answer_id, 'previousTier', v_previous, 'tier', p_tier);
end;
$$;

comment on function public.admin_deep_cut_set_tier(integer, integer) is
  'Re-tiers a Deep Cut answer and pins the tier against bank reloads. Requires staff.';

revoke all on function public.admin_deep_cut_set_tier(integer, integer) from public, anon;
grant execute on function public.admin_deep_cut_set_tier(integer, integer) to authenticated;

-- ── The service bridge twins ────────────────────────────────────────────────

create or replace function public.admin_deep_cut_reviews_svc(
  p_actor   uuid,
  p_verdict text default 'pending',
  p_search  text default null,
  p_limit   integer default 50,
  p_offset  integer default 0
)
returns table (
  question_id     integer,
  question_slug   text,
  category        text,
  prompt          text,
  key             text,
  sample          text,
  verdict         text,
  reviewer        text,
  seen            integer,
  first_seen      timestamptz,
  reviewed_at     timestamptz,
  answer_id       integer,
  answer_name     text,
  answer_tier     integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query
  select * from public.admin_deep_cut_reviews(p_verdict, p_search, p_limit, p_offset);
end;
$$;

create or replace function public.admin_deep_cut_answers_svc(p_actor uuid, p_question_id integer)
returns table (
  id             integer,
  canonical      text,
  tier           integer,
  source         text,
  spellings      integer,
  given          bigint,
  share_percent  numeric,
  suggested_tier integer
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return query select * from public.admin_deep_cut_answers(p_question_id);
end;
$$;

create or replace function public.admin_deep_cut_rule_svc(
  p_actor       uuid,
  p_question_id integer,
  p_key         text,
  p_verdict     text,
  p_canonical   text default null,
  p_tier        integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_deep_cut_rule(p_question_id, p_key, p_verdict, p_canonical, p_tier);
end;
$$;

create or replace function public.admin_deep_cut_set_tier_svc(p_actor uuid, p_answer_id integer, p_tier integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_actor is null then
    raise exception 'a verified actor is required' using errcode = '22023';
  end if;
  perform set_config('app.admin_bridge_actor', p_actor::text, true);
  return public.admin_deep_cut_set_tier(p_answer_id, p_tier);
end;
$$;

revoke all on function public.admin_deep_cut_reviews_svc(uuid, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.admin_deep_cut_answers_svc(uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_deep_cut_rule_svc(uuid, integer, text, text, text, integer) from public, anon, authenticated;
revoke all on function public.admin_deep_cut_set_tier_svc(uuid, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_deep_cut_reviews_svc(uuid, text, text, integer, integer) to service_role;
grant execute on function public.admin_deep_cut_answers_svc(uuid, integer) to service_role;
grant execute on function public.admin_deep_cut_rule_svc(uuid, integer, text, text, text, integer) to service_role;
grant execute on function public.admin_deep_cut_set_tier_svc(uuid, integer, integer) to service_role;
