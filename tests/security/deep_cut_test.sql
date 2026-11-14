-- Deep Cut: the answer matcher, the clock, the daily run, practice, the AI judge's
-- calls and the verifier.
--
-- Runs after the migrations on a throwaway database (scripts/test-rls.sh), and rolls
-- everything back. Each check raises on failure, so the file stops at the first one.

\set ON_ERROR_STOP on

begin;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'refusing to run against a hosted Supabase project';
  end if;
end $$;

-- ── Fixtures ────────────────────────────────────────────────────────────────

create or replace function pg_temp.player(p_name text)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email) values (v_id, p_name || '@example.com');
  insert into public.profiles (id, username, display_name)
  values (v_id, p_name, p_name)
  on conflict (id) do nothing;
  return v_id;
end;
$$;

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_user is null then '{"role":"anon"}'
         else json_build_object('sub', p_user, 'role', 'authenticated')::text end, true);
end;
$$;

create or replace function pg_temp.ok(p_label text, p_condition boolean)
returns void language plpgsql as $$
begin
  if p_condition is distinct from true then
    raise exception 'FAILED: %', p_label;
  end if;
  raise notice 'ok   %', p_label;
end;
$$;

create or replace function pg_temp.qid(p_slug text)
returns smallint language sql as $$
  select id from public.deep_cut_questions where slug = p_slug
$$;

-- ── The key ─────────────────────────────────────────────────────────────────

select pg_temp.ok('keys fold case, accents, punctuation and a leading article',
  public.deep_cut_key('  The Rolls-Royce ') = 'rollsroyce'
  and public.deep_cut_key('Côte d''Ivoire') = 'cotedivoire'
  and public.deep_cut_key('São Tomé & Príncipe') = 'saotomeandprincipe'
  and public.deep_cut_key('Straße') = 'strasse');

select pg_temp.ok('C, C++ and C# are three keys',
  public.deep_cut_key('C') = 'c' and public.deep_cut_key('C++') = 'cplusplus'
  and public.deep_cut_key('c#') = 'csharp');

select pg_temp.ok('an answer of nothing but punctuation has no key',
  public.deep_cut_key('?!--') = '');

-- ── The matcher ─────────────────────────────────────────────────────────────

select pg_temp.ok('an exact answer matches',
  (select kind from public.deep_cut_lookup(pg_temp.qid('us-state'), public.deep_cut_key('Delaware'))) = 'exact');

select pg_temp.ok('an abbreviation matches its answer',
  (select a.canonical from public.deep_cut_lookup(pg_temp.qid('us-state'), 'ca') l
     join public.deep_cut_answers a on a.id = l.answer_id) = 'California');

select pg_temp.ok('another name matches its answer',
  (select a.canonical from public.deep_cut_lookup(pg_temp.qid('africa-country'), 'swaziland') l
     join public.deep_cut_answers a on a.id = l.answer_id) = 'Eswatini');

select pg_temp.ok('a plural matches',
  (select kind from public.deep_cut_lookup(pg_temp.qid('fruit'), 'grapes')) = 'plural');

select pg_temp.ok('one typo in a medium word matches',
  (select a.canonical from public.deep_cut_lookup(pg_temp.qid('us-state'), 'misissippi') l
     join public.deep_cut_answers a on a.id = l.answer_id) = 'Mississippi');

select pg_temp.ok('a swapped pair of letters is one typo',
  (select a.canonical from public.deep_cut_lookup(pg_temp.qid('us-state'), 'nevdaa') l
     join public.deep_cut_answers a on a.id = l.answer_id) = 'Nevada');

select pg_temp.ok('short answers forgive no typos (Iran is never Iraq)',
  (select kind from public.deep_cut_lookup(pg_temp.qid('asia-country'), 'irak')) = 'unknown');

select pg_temp.ok('Australia is not a typo of Austria',
  (select kind from public.deep_cut_lookup(pg_temp.qid('europe-country'), 'australia')) = 'unknown');

select pg_temp.ok('a wrong answer is unknown, not a match',
  (select answer_id from public.deep_cut_lookup(pg_temp.qid('us-state'), 'ontario')) is null);

-- ── Suggestions ─────────────────────────────────────────────────────────────

select pg_temp.ok('a shared uncommon word suggests its answer (New York City → New York)',
  public.deep_cut_suggest(pg_temp.qid('us-state'), 'New York City') = array['New York']);

select pg_temp.ok('a unique start suggests its answer (Rhode → Rhode Island)',
  public.deep_cut_suggest(pg_temp.qid('us-state'), 'Rhode') = array['Rhode Island']);

select pg_temp.ok('a spelling just past the typo allowance is suggested',
  'Mississippi' = any(public.deep_cut_suggest(pg_temp.qid('us-state'), 'Missisipi')));

select pg_temp.ok('a word in three or more answers suggests nothing (New)',
  public.deep_cut_suggest(pg_temp.qid('us-state'), 'New') = '{}');

select pg_temp.ok('an unrelated answer suggests nothing',
  public.deep_cut_suggest(pg_temp.qid('us-state'), 'Carrot') = '{}');

select pg_temp.ok('never more than two suggestions',
  coalesce(array_length(public.deep_cut_suggest(pg_temp.qid('us-state'), 'North South Carolina Dakota'), 1), 0) <= 2);

-- ── The days ────────────────────────────────────────────────────────────────

select pg_temp.ok('a day has seven distinct questions, and keeps them',
  cardinality(public.deep_cut_day_questions(20000)) = 7
  and (select count(distinct q) from unnest(public.deep_cut_day_questions(20000)) q) = 7
  and public.deep_cut_day_questions(20000) = public.deep_cut_day_questions(20000));

select pg_temp.ok('consecutive days do not repeat a question',
  not (public.deep_cut_day_questions(20001) && public.deep_cut_day_questions(20000)));

select pg_temp.ok('the repeat window grows with the bank (100 questions: 13 days)',
  public.deep_cut_repeat_window() = (select count(*)::integer / 7 - 1 from public.deep_cut_questions where active)
  and public.deep_cut_repeat_window() >= 13);

-- Days are chosen once, in order, each looking back at the ones before it.
do $$ begin for d in 30000..30030 loop perform public.deep_cut_day_questions(d); end loop; end $$;
select pg_temp.ok('no question comes back within the window',
  (select bool_and(not (public.deep_cut_day_questions(30000 + d) && public.deep_cut_day_questions(30000 + d - w)))
     from generate_series(14, 30) d, generate_series(1, 13) w));

-- ── Privileges ──────────────────────────────────────────────────────────────

set local role anon;
do $$
begin
  begin
    perform 1 from public.deep_cut_answers limit 1;
    raise exception 'FAILED: anon read the answer bank';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.deep_cut_lookup(1::smallint, 'x');
    raise exception 'FAILED: anon called the matcher directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.deep_cut_load_question('x-x', 'Test', 'Name a test thing', '[]');
    raise exception 'FAILED: anon loaded a question';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.ok('the bank, the matcher and the loader are closed to clients', true);

-- ── A daily run ─────────────────────────────────────────────────────────────

create temp table t_ctx (name text primary key, id uuid);
insert into t_ctx values ('ada', pg_temp.player('deepcut_ada'));

select pg_temp.act_as((select id from t_ctx where name = 'ada'));
insert into t_ctx
select 'session', (public.start_game_session('deep-cut', 'deep-cut@1', null, 'UTC')).id;

select pg_temp.ok('a daily session is seeded with the player''s day',
  (select seed from public.game_sessions where id = (select id from t_ctx where name = 'session'))
    = public.player_local_day('UTC'));

select pg_temp.ok('questions come in order',
  public.deep_cut_reveal((select id from t_ctx where name = 'session'), 1)->>'outcome' = 'out_of_order');

select pg_temp.ok('the first question is dealt with a 25-second clock',
  (select r->>'outcome' = 'shown' and (r->>'seconds')::int = 25 and r->>'prompt' like 'Name %'
     from public.deep_cut_reveal((select id from t_ctx where name = 'session'), 0) r));

-- Answer it with its rarest listed answer, whatever the day dealt.
create temp table t_answer as
select a.canonical, a.tier, a.id
  from public.deep_cut_turns t
  join public.deep_cut_answers a on a.question_id = t.question_id
 where t.run_id = (select id from t_ctx where name = 'session') and t.position = 0
 order by a.tier desc, a.id
 limit 1;

select pg_temp.ok('a correct answer scores its tier',
  (select (r->'turn'->>'points')::int = public.deep_cut_tier_points(t.tier)
          and r->'turn'->>'verdict' = 'correct'
          and (r->'turn'->>'answerId')::int = t.id
     from t_answer t,
          public.deep_cut_answer((select id from t_ctx where name = 'session'), 0, t.canonical) r));

select pg_temp.ok('a daily turn never shows the rarest answers',
  (select r->'turn'->>'deepestAnswers' is null
     from public.deep_cut_answer((select id from t_ctx where name = 'session'), 0, 'anything') r));

select pg_temp.ok('a question takes one answer: a second one changes nothing',
  (select (r->'turn'->>'answerId')::int = t.id
     from t_answer t,
          public.deep_cut_answer((select id from t_ctx where name = 'session'), 0, 'zzzz nonsense') r));

select public.deep_cut_reveal((select id from t_ctx where name = 'session'), 1);

-- ── Checking before submitting ──────────────────────────────────────────────

select pg_temp.ok('a check says a listed answer is valid, and nothing more',
  (select c = jsonb_build_object('outcome', 'checked', 'result', 'valid')
     from public.deep_cut_answers a
     join public.deep_cut_turns t on t.question_id = a.question_id,
          public.deep_cut_check((select id from t_ctx where name = 'session'), 1, a.canonical) c
    where t.run_id = (select id from t_ctx where name = 'session') and t.position = 1
    order by a.tier desc limit 1));

select pg_temp.ok('a valid check carries no suggestions',
  (select not (c ? 'suggestions')
     from public.deep_cut_answers a
     join public.deep_cut_turns t on t.question_id = a.question_id,
          public.deep_cut_check((select id from t_ctx where name = 'session'), 1, a.canonical) c
    where t.run_id = (select id from t_ctx where name = 'session') and t.position = 1
    limit 1));

select pg_temp.ok('a check that does not count carries a suggestions list',
  jsonb_typeof(public.deep_cut_check((select id from t_ctx where name = 'session'), 1, 'Qwxzzy Blorptown')->'suggestions') = 'array');

select pg_temp.ok('a check on a spelling nobody judged is unknown',
  public.deep_cut_check((select id from t_ctx where name = 'session'), 1, 'Qwxzzy Blorptown')->>'result' = 'unknown');

select pg_temp.ok('a check on nothing is empty',
  public.deep_cut_check((select id from t_ctx where name = 'session'), 1, '  ?! ')->>'result' = 'empty');

select pg_temp.ok('a check records nothing: the turn stays open and nothing is queued',
  (select submitted_at is null and verdict is null from public.deep_cut_turns
    where run_id = (select id from t_ctx where name = 'session') and position = 1)
  and not exists (select 1 from public.deep_cut_reviews where key = 'qwxzzyblorptown'));

select pg_temp.ok('a question not dealt yet cannot be checked',
  public.deep_cut_check((select id from t_ctx where name = 'session'), 3, 'Texas')->>'outcome' = 'not_shown');

select pg_temp.ok('an answered question cannot be checked',
  public.deep_cut_check((select id from t_ctx where name = 'session'), 0, 'Texas')->>'outcome' = 'already_answered');

insert into t_ctx values ('ivy', pg_temp.player('deepcut_ivy'));
select pg_temp.act_as((select id from t_ctx where name = 'ivy'));
select pg_temp.ok('another player''s run cannot be checked',
  public.deep_cut_check((select id from t_ctx where name = 'session'), 1, 'Texas')->>'outcome' = 'not_found');
select pg_temp.act_as((select id from t_ctx where name = 'ada'));

select pg_temp.ok('a made-up answer scores nothing',
  (select r->'turn'->>'verdict' = 'unverified' and (r->'turn'->>'points')::int = 0
     from public.deep_cut_answer((select id from t_ctx where name = 'session'), 1, 'Qwxzzy Blorptown') r));

select pg_temp.ok('a made-up answer waits for a reviewer',
  exists (select 1 from public.deep_cut_reviews where key = 'qwxzzyblorptown' and verdict = 'pending'));

-- Question three: let its clock run out.
select public.deep_cut_reveal((select id from t_ctx where name = 'session'), 2);
update public.deep_cut_turns set shown_at = now() - interval '40 seconds'
 where run_id = (select id from t_ctx where name = 'session') and position = 2;
select pg_temp.ok('an answer after the clock is out of time',
  (select r->'turn'->>'verdict' = 'timeout'
     from public.deep_cut_answer((select id from t_ctx where name = 'session'), 2, 'anything') r));

-- Starting again mid-run continues the same run: no fresh look at question one.
insert into t_ctx
select 'session2', (public.start_game_session('deep-cut', 'deep-cut@1', null, 'UTC')).id;
select pg_temp.ok('a new session the same day continues the run',
  (select r->>'outcome' = 'shown' and r->'settled'->>'verdict' = 'correct'
     from public.deep_cut_reveal((select id from t_ctx where name = 'session2'), 0) r)
  and public.deep_cut_reveal((select id from t_ctx where name = 'session2'), 3)->>'outcome' = 'shown');

select pg_temp.ok('another player cannot touch the run',
  (select public.deep_cut_reveal((select id from t_ctx where name = 'session2'), 3)->>'outcome'
     from (select pg_temp.act_as(pg_temp.player('deepcut_eve'))) x) = 'not_found');
select pg_temp.act_as((select id from t_ctx where name = 'ada'));

-- ── The verifier ────────────────────────────────────────────────────────────

select pg_temp.ok('a claim the turns do not support is refused',
  (public.complete_deep_cut_run((select id from t_ctx where name = 'session2'),
     array[(select id from t_answer), 0, 0, 0], 99, 1)).outcome = 'score_mismatch');

select pg_temp.ok('actions that are not the turns are refused',
  (public.complete_deep_cut_run((select id from t_ctx where name = 'session2'),
     array[0, 0, 0, 0], 0, 1)).outcome = 'invalid_actions');

select pg_temp.ok('the run verifies and records the turns'' points (a tenth on screen)',
  (select r.outcome = 'recorded' and r.score = (select public.deep_cut_tier_points(tier) / 10 from t_answer)
     from public.complete_deep_cut_run((select id from t_ctx where name = 'session2'),
       array[(select id from t_answer), 0, 0, 0],
       (select public.deep_cut_tier_points(tier) / 10 from t_answer), 1) r));

select pg_temp.ok('the open fourth question was settled as skipped',
  (select verdict from public.deep_cut_turns
    where run_id = (select id from t_ctx where name = 'session') and position = 3) = 'skipped');

select pg_temp.ok('one ranked play a day',
  (public.start_game_session('deep-cut', 'deep-cut@1', null, 'UTC')).outcome = 'already_played');

select pg_temp.ok('a finished run deals nothing more',
  public.deep_cut_reveal((select id from t_ctx where name = 'session2'), 4)->>'outcome' = 'closed');

-- ── Practice ────────────────────────────────────────────────────────────────

insert into t_ctx select 'practice', (public.deep_cut_start_practice('unlimited', null)->>'runId')::uuid;
select pg_temp.ok('unlimited deals seven questions, none of them live',
  (select cardinality(question_ids) = 7 and not (question_ids && public.deep_cut_live_questions())
     from public.deep_cut_runs where id = (select id from t_ctx where name = 'practice')));

select public.deep_cut_reveal((select id from t_ctx where name = 'practice'), 0);
select pg_temp.ok('practice shows the rarest answers once a question is answered',
  (select r->'turn'->>'deepestAnswers' is not null
     from public.deep_cut_answer((select id from t_ctx where name = 'practice'), 0, 'zzz') r));

select pg_temp.ok('a practice summary totals the run',
  (select s->>'outcome' = 'finished' and jsonb_array_length(s->'turns') = 1
     from public.deep_cut_practice_summary((select id from t_ctx where name = 'practice')) s));
select pg_temp.ok('a summed practice run deals nothing more',
  public.deep_cut_reveal((select id from t_ctx where name = 'practice'), 1)->>'outcome' = 'expired');

select pg_temp.ok('the archive refuses today and yesterday, and goes back thirty days',
  public.deep_cut_start_practice('archive', public.deep_cut_utc_day())->>'outcome' = 'not_available'
  and public.deep_cut_start_practice('archive', public.deep_cut_utc_day() - 1)->>'outcome' = 'not_available'
  and public.deep_cut_start_practice('archive', public.deep_cut_utc_day() - 31)->>'outcome' = 'not_available');

select pg_temp.ok('the archive lists the twenty-nine days it can deal',
  cardinality(public.deep_cut_archive_days()) = 29
  and (public.deep_cut_archive_days())[1] = public.deep_cut_utc_day() - 2);

insert into t_ctx
select 'archive', (public.deep_cut_start_practice('archive', public.deep_cut_utc_day() - 3)->>'runId')::uuid;
select pg_temp.ok('an archived day deals its own questions, minus any back in a live set',
  (select not (r.question_ids && public.deep_cut_live_questions())
          and cardinality(r.question_ids) = 7
     from public.deep_cut_runs r where r.id = (select id from t_ctx where name = 'archive'))
  and (select count(*) from unnest(public.deep_cut_day_questions(public.deep_cut_utc_day() - 3)) q
        where not (q = any(public.deep_cut_live_questions()))
          and q = any((select question_ids from public.deep_cut_runs
                        where id = (select id from t_ctx where name = 'archive'))::smallint[]))
      = (select count(*) from unnest(public.deep_cut_day_questions(public.deep_cut_utc_day() - 3)) q
          where not (q = any(public.deep_cut_live_questions()))));

-- ── The AI judge ────────────────────────────────────────────────────────────

insert into public.deep_cut_judge_keys (key_hash, label)
values (sha256(convert_to('test-judge-key-0123456789abcdef0123456789', 'UTF8')), 'test');

insert into t_ctx select 'judged', (public.deep_cut_start_practice('unlimited', null)->>'runId')::uuid;
select public.deep_cut_reveal((select id from t_ctx where name = 'judged'), 0);

select pg_temp.ok('an unjudged answer is held for the judge',
  public.deep_cut_answer((select id from t_ctx where name = 'judged'), 0, 'Glorbix Prime', false)->>'outcome' = 'unknown');

select pg_temp.ok('a held answer cannot be swapped for another',
  public.deep_cut_answer((select id from t_ctx where name = 'judged'), 0, 'Something Else', true)->>'outcome' = 'already_answered');

do $$
begin
  begin
    perform public.deep_cut_judge_context('wrong-key-wrong-key-wrong-key-wrong-key',
      (select id from t_ctx where name = 'judged'), 0);
    raise exception 'FAILED: a wrong judge key was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;
select pg_temp.ok('the judge''s calls need its key', true);

select pg_temp.ok('the judge sees the prompt, the answer and the known answers',
  (select c->>'outcome' = 'held' and c->>'answer' = 'Glorbix Prime' and jsonb_array_length(c->'known') > 5
     from public.deep_cut_judge_context('test-judge-key-0123456789abcdef0123456789',
       (select id from t_ctx where name = 'judged'), 0) c));

select pg_temp.ok('an accepted answer joins the bank, its tier capped below the abyss',
  public.deep_cut_record_review('test-judge-key-0123456789abcdef0123456789',
    (select question_id from public.deep_cut_turns where run_id = (select id from t_ctx where name = 'judged')),
    'glorbixprime', 'Glorbix Prime', 'accepted', 'Glorbix Prime', 6) = 'accepted');

select pg_temp.ok('the held answer then scores the judged tier',
  (select r->'turn'->>'verdict' = 'correct' and (r->'turn'->>'points')::int = 80
     from public.deep_cut_answer((select id from t_ctx where name = 'judged'), 0, 'Glorbix Prime', true) r));

select pg_temp.ok('a spelling is judged once',
  public.deep_cut_record_review('test-judge-key-0123456789abcdef0123456789',
    (select question_id from public.deep_cut_turns where run_id = (select id from t_ctx where name = 'judged')),
    'glorbixprime', 'Glorbix Prime', 'rejected', null, null) = 'already_judged');

select public.deep_cut_reveal((select id from t_ctx where name = 'judged'), 1);
select public.deep_cut_answer((select id from t_ctx where name = 'judged'), 1, 'Fakeanswer Zed', false);
select public.deep_cut_record_review('test-judge-key-0123456789abcdef0123456789',
  (select question_id from public.deep_cut_turns
    where run_id = (select id from t_ctx where name = 'judged') and position = 1),
  'fakeanswerzed', 'Fakeanswer Zed', 'rejected', null, null);
select pg_temp.ok('a rejected answer is wrong, for everyone after',
  (select r->'turn'->>'verdict' = 'wrong'
     from public.deep_cut_answer((select id from t_ctx where name = 'judged'), 1, 'Fakeanswer Zed', true) r)
  and (select kind from public.deep_cut_lookup(
         (select question_id from public.deep_cut_turns
           where run_id = (select id from t_ctx where name = 'judged') and position = 1),
         'fakeanswerzed')) = 'rejected');

select public.deep_cut_reveal((select id from t_ctx where name = 'judged'), 2);
select pg_temp.ok('the judge can see an answer being checked on an open turn',
  (select c->>'outcome' = 'held' and c->>'key' = 'zibblewort' and c->>'answer' = 'Zibble wort'
     from public.deep_cut_check_context('test-judge-key-0123456789abcdef0123456789',
       (select id from t_ctx where name = 'judged'), 2, '  Zibble   wort ') c));
select public.deep_cut_record_review('test-judge-key-0123456789abcdef0123456789',
  (select question_id from public.deep_cut_turns
    where run_id = (select id from t_ctx where name = 'judged') and position = 2),
  'zibblewort', 'Zibble wort', 'rejected', null, null);
select pg_temp.ok('a check after a rejection is invalid, and the turn is still open',
  public.deep_cut_check((select id from t_ctx where name = 'judged'), 2, 'Zibble wort')->>'result' = 'invalid'
  and (select submitted_at is null from public.deep_cut_turns
        where run_id = (select id from t_ctx where name = 'judged') and position = 2));

-- ── Staff review ────────────────────────────────────────────────────────────

select public.deep_cut_staff_review(
  (select question_id from public.deep_cut_reviews where key = 'qwxzzyblorptown')::integer,
  'qwxzzyblorptown', 'accepted', 'Qwxzzy Blorptown', 6);
select pg_temp.ok('a queued answer can be accepted by staff at any tier',
  (select a.tier from public.deep_cut_lookup(
     (select question_id from public.deep_cut_reviews where key = 'qwxzzyblorptown'), 'qwxzzyblorptown') l
     join public.deep_cut_answers a on a.id = l.answer_id) = 6
  and (select reviewer from public.deep_cut_reviews where key = 'qwxzzyblorptown') = 'staff');

set local role authenticated;
do $$
begin
  begin
    perform public.deep_cut_staff_review(1, 'x', 'rejected');
    raise exception 'FAILED: a client called the staff review';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.ok('the staff review is closed to clients', true);

-- ── The admin console's queue ───────────────────────────────────────────────

insert into t_ctx values ('mod', pg_temp.player('deepcut_mod'));
insert into public.user_roles (user_id, role)
values ((select id from t_ctx where name = 'mod'), 'moderator')
on conflict (user_id) do update set role = 'moderator';

select pg_temp.act_as((select id from t_ctx where name = 'ada'));
select public.deep_cut_reveal((select id from t_ctx where name = 'judged'), 3);
select public.deep_cut_answer((select id from t_ctx where name = 'judged'), 3, 'Plonkberry', true);

select pg_temp.act_as((select id from t_ctx where name = 'ada'));
set local role authenticated;
do $$
begin
  begin
    perform * from public.admin_deep_cut_reviews();
    raise exception 'FAILED: a player read the review queue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_deep_cut_set_tier(1, 6);
    raise exception 'FAILED: a player re-tiered an answer';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.ok('the queue is closed to players', true);

create temp table t_q as
select r.question_id from public.deep_cut_reviews r where r.key = 'plonkberry';
grant select on t_q to authenticated;

select pg_temp.act_as((select id from t_ctx where name = 'mod'));
set local role authenticated;
select pg_temp.ok('staff see a pending spelling with its question',
  exists (select 1 from public.admin_deep_cut_reviews('pending', 'plonk')
           where key = 'plonkberry' and sample = 'Plonkberry' and prompt like 'Name %' and seen = 1));

select pg_temp.ok('staff see a question''s answers',
  (select count(*) > 5 from public.admin_deep_cut_answers((select question_id from t_q))));

select pg_temp.ok('staff can file a spelling under an existing answer',
  (select r->>'verdict' = 'accepted' and r->>'previousVerdict' = 'pending'
     from public.admin_deep_cut_rule(
       (select question_id from t_q), 'plonkberry', 'accepted',
       (select canonical from public.admin_deep_cut_answers((select question_id from t_q))
         order by tier, canonical limit 1),
       1) r));

select pg_temp.ok('a ruled spelling leaves the pending queue',
  not exists (select 1 from public.admin_deep_cut_reviews('pending', 'plonk'))
  and exists (select 1 from public.admin_deep_cut_reviews('accepted', 'plonk') where answer_tier = 1));

select pg_temp.ok('staff can re-tier an answer',
  (select r->>'tier' = '6'
     from public.admin_deep_cut_set_tier(
       (select answer_id from public.admin_deep_cut_reviews('accepted', 'plonk') limit 1), 6) r));
reset role;

select pg_temp.ok('a re-tiered answer is pinned as staff''s',
  (select source = 'staff' and tier = 6 from public.deep_cut_answers
    where id = (select r.answer_id from public.deep_cut_reviews r where r.key = 'plonkberry')));

-- A bank reload keeps the hand-set tier.
do $$
declare
  v_q   public.deep_cut_questions;
  v_ans jsonb;
begin
  select q.* into v_q from public.deep_cut_questions q
   where q.id = (select r.question_id from public.deep_cut_reviews r where r.key = 'plonkberry');
  select jsonb_agg(jsonb_build_object('name', a.canonical, 'tier', 1)) into v_ans
    from public.deep_cut_answers a where a.question_id = v_q.id;
  perform public.deep_cut_load_question(v_q.slug, v_q.category, v_q.prompt, v_ans);
end $$;
select pg_temp.ok('a bank reload keeps a tier staff set by hand',
  (select tier = 6 from public.deep_cut_answers
    where id = (select r.answer_id from public.deep_cut_reviews r where r.key = 'plonkberry')));

-- ── Party (hot potato) ──────────────────────────────────────────────────────

select pg_temp.act_as((select id from t_ctx where name = 'ada'));

select pg_temp.ok('a party needs 2 to 8 players',
  public.deep_cut_party_start(1)->>'outcome' = 'invalid_players'
  and public.deep_cut_party_start(9)->>'outcome' = 'invalid_players');

insert into t_ctx select 'party', (public.deep_cut_party_start(3)->>'partyId')::uuid;

select pg_temp.ok('rounds come in order',
  public.deep_cut_party_question((select id from t_ctx where name = 'party'), 1)->>'outcome' = 'out_of_order');

select pg_temp.ok('a round deals a question with nothing said yet',
  (select r->>'outcome' = 'shown' and r->>'prompt' like 'Name %' and jsonb_array_length(r->'used') = 0
     from public.deep_cut_party_question((select id from t_ctx where name = 'party'), 0) r));

select pg_temp.ok('a party never deals a question live in a daily set',
  not ((select question_ids from public.deep_cut_parties where id = (select id from t_ctx where name = 'party'))
       && public.deep_cut_live_questions()));

create temp table t_party_answer as
select a.canonical, a.tier
  from public.deep_cut_parties p
  join public.deep_cut_answers a on a.question_id = p.question_ids[1]
 where p.id = (select id from t_ctx where name = 'party')
 order by a.tier, a.id
 limit 1;

select pg_temp.ok('a correct answer is valid and scores its tier',
  (select r->>'result' = 'valid' and (r->>'points')::int = public.deep_cut_tier_points(t.tier)
     from t_party_answer t,
          public.deep_cut_party_answer((select id from t_ctx where name = 'party'), 0, 0, t.canonical) r));

select pg_temp.ok('the same answer from the next player is a repeat',
  (select r->>'result' = 'repeat' and r->>'canonical' = t.canonical
     from t_party_answer t,
          public.deep_cut_party_answer((select id from t_ctx where name = 'party'), 0, 1, lower(t.canonical)) r));

select pg_temp.ok('a made-up answer is unknown and records nothing',
  public.deep_cut_party_answer((select id from t_ctx where name = 'party'), 0, 1, 'Blorptastic Zed')->>'result' = 'unknown'
  and (select count(*) from public.deep_cut_party_answers where party_id = (select id from t_ctx where name = 'party')) = 1);

select pg_temp.ok('the round shows what was said, by whom',
  (select r->'used'->0->>'player' = '0' and jsonb_array_length(r->'used') = 1
     from public.deep_cut_party_question((select id from t_ctx where name = 'party'), 0) r));

select pg_temp.ok('a player outside the party cannot answer',
  public.deep_cut_party_answer((select id from t_ctx where name = 'party'), 0, 3, 'x')->>'outcome' = 'invalid_player');

select pg_temp.ok('a round not dealt yet cannot be answered',
  public.deep_cut_party_answer((select id from t_ctx where name = 'party'), 1, 0, 'x')->>'outcome' = 'not_shown');

select pg_temp.ok('the next round is dealt',
  public.deep_cut_party_question((select id from t_ctx where name = 'party'), 1)->>'outcome' = 'shown');
select pg_temp.ok('the next round deals a different question',
  (select cardinality(question_ids) = 2 and question_ids[1] <> question_ids[2] from public.deep_cut_parties
    where id = (select id from t_ctx where name = 'party')));

select pg_temp.act_as((select id from t_ctx where name = 'ivy'));
select pg_temp.ok('another player''s party is not found',
  public.deep_cut_party_question((select id from t_ctx where name = 'party'), 0)->>'outcome' = 'not_found');
select pg_temp.act_as((select id from t_ctx where name = 'ada'));

select pg_temp.ok('the judge can see an unjudged party answer',
  (select c->>'outcome' = 'held' and c->>'key' = 'blorptasticzed'
     from public.deep_cut_party_context('test-judge-key-0123456789abcdef0123456789',
       (select id from t_ctx where name = 'party'), 0, 'Blorptastic Zed') c));

update public.deep_cut_parties set expires_at = now() - interval '1 second'
 where id = (select id from t_ctx where name = 'party');
select pg_temp.ok('an ended party is not found',
  public.deep_cut_party_question((select id from t_ctx where name = 'party'), 0)->>'outcome' = 'not_found');

set local role anon;
do $$
begin
  begin
    perform 1 from public.deep_cut_party_answers limit 1;
    raise exception 'FAILED: anon read party answers';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select pg_temp.ok('party tables are closed to clients', true);

rollback;

\echo 'Deep Cut suite passed.'
