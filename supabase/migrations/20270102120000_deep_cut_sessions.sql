-- Deep Cut (`deep-cut@1`): the rare-answer trivia game, scored by the database.
--
-- Seven questions a day ("Name a US state"), 25 seconds and one answer each. A
-- correct answer scores by how rarely people give it: 10 points for the answer
-- everybody says, up to 100 for one almost nobody does. 700 is a perfect day.
--
-- Unlike every game before it, the rules cannot travel to the browser: the answer
-- bank *is* the score, and a client holding it could look up the rarest answer to
-- every question. So the database deals the questions one at a time and judges
-- each answer as it arrives; the client never sees a question before its clock
-- starts, or an answer it did not type.
--
--   1. The bank: questions, answers with a rarity tier (1–6), and every spelling
--      that names an answer (aliases, abbreviations), stored as a normalised key.
--      `deep_cut_key` is the normaliser; `deep_cut_lookup` matches a key exactly,
--      then as a plural, then within a small, length-scaled edit distance (typos).
--   2. Reviews: the cache of judgements on spellings the bank did not know. A
--      spelling is judged once — by the AI judge in the game-sessions service, or
--      by staff — and that verdict is final for everyone after, so the same
--      answer always scores the same. The AI never sets a score directly: it can
--      only accept a spelling onto the bank at a capped tier, or reject it.
--   3. The days: each day's seven questions, chosen once and kept, so every player
--      and the archive see the same set. Questions used in the six days before
--      are skipped where the bank allows.
--   4. Runs and turns: a run is seven turns. `deep_cut_reveal` starts a turn's clock
--      and hands over its prompt; `deep_cut_answer` judges an answer against the
--      clock (25 s and a little grace) and records it. One answer per question, in
--      order. A signed-in player's daily run is theirs for the day: starting again
--      continues it rather than dealing the same questions afresh.
--   5. Practice: the Unlimited and Archive modes are unranked runs with no session,
--      scored the same way. They never deal a question that is in any player's
--      daily set right now, so practice cannot be used to probe today's answers.
--   6. `complete_deep_cut_run`, the verifier: the generic gate, one ranked
--      completion a day, and the score derived from the recorded turns. The
--      submitted actions are the answers' ids; the claim is compared, never
--      trusted.
--
-- `20270102120100_deep_cut_bank.sql` loads the bank (generated from
-- scripts/deep-cut/bank.txt); `20270102120200_deep_cut_playable.sql` flips the
-- catalogue and lands last. Mirrored by src/lib/games/deep-cut.ts. See
-- docs/games/README.md.

-- ─────────────────────────────────────────────────────────────────────────────
-- The rules
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.deep_cut_rules_version()
returns text language sql immutable set search_path = '' as $$ select 'deep-cut@1'::text $$;

-- Seven questions, one answer each.
create or replace function public.deep_cut_questions_per_run()
returns integer language sql immutable set search_path = '' as $$ select 7 $$;

-- The clock a question shows, and the grace the server adds for the network.
create or replace function public.deep_cut_answer_seconds()
returns integer language sql immutable set search_path = '' as $$ select 25 $$;

create or replace function public.deep_cut_grace_seconds()
returns integer language sql immutable set search_path = '' as $$ select 3 $$;

-- A tier's points on screen: 10, 20, 40, 60, 80, 100. The verified score is a
-- tenth of that, as every game's is (SCORE_SCALE on the client).
create or replace function public.deep_cut_tier_points(p_tier integer)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case p_tier
    when 1 then 10 when 2 then 20 when 3 then 40
    when 4 then 60 when 5 then 80 when 6 then 100
    else 0 end
$$;

comment on function public.deep_cut_rules_version() is 'The Deep Cut rules version: deep-cut@1.';
comment on function public.deep_cut_tier_points(integer) is
  'Points on screen for a Deep Cut rarity tier: Surface 10, Shallows 20, Reef 40, Twilight 60, Midnight 80, Abyss 100.';

-- ─────────────────────────────────────────────────────────────────────────────
-- The bank
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.deep_cut_questions (
  id         smallint generated always as identity primary key,
  slug       text not null unique,
  category   text not null,
  prompt     text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint deep_cut_questions_slug check (slug ~ '^[a-z0-9-]{2,48}$'),
  constraint deep_cut_questions_category check (char_length(category) between 2 and 24),
  constraint deep_cut_questions_prompt check (char_length(prompt) between 8 and 120)
);

create table if not exists public.deep_cut_answers (
  id          integer generated always as identity primary key,
  question_id smallint not null references public.deep_cut_questions (id) on delete cascade,
  canonical   text not null,
  tier        smallint not null,
  source      text not null default 'curated',
  created_at  timestamptz not null default now(),
  constraint deep_cut_answers_canonical check (char_length(canonical) between 1 and 60),
  constraint deep_cut_answers_tier check (tier between 1 and 6),
  constraint deep_cut_answers_source check (source in ('curated', 'ai', 'staff')),
  unique (question_id, canonical)
);

-- Every spelling that names an answer, as its normalised key.
create table if not exists public.deep_cut_spellings (
  question_id smallint not null references public.deep_cut_questions (id) on delete cascade,
  key         text not null,
  answer_id   integer not null references public.deep_cut_answers (id) on delete cascade,
  primary key (question_id, key),
  constraint deep_cut_spellings_key check (key ~ '^[a-z0-9]{1,60}$')
);

create index if not exists deep_cut_spellings_answer_idx on public.deep_cut_spellings (answer_id);

-- The cache of judgements on spellings the bank did not know. `pending` is a
-- spelling waiting for a reviewer (it scored nothing when it was played).
create table if not exists public.deep_cut_reviews (
  question_id smallint not null references public.deep_cut_questions (id) on delete cascade,
  key         text not null,
  sample      text not null,
  verdict     text not null default 'pending',
  answer_id   integer references public.deep_cut_answers (id) on delete set null,
  reviewer    text,
  seen        integer not null default 1,
  first_seen  timestamptz not null default now(),
  reviewed_at timestamptz,
  primary key (question_id, key),
  constraint deep_cut_reviews_key check (key ~ '^[a-z0-9]{1,60}$'),
  constraint deep_cut_reviews_sample check (char_length(sample) between 1 and 60),
  constraint deep_cut_reviews_verdict check (verdict in ('pending', 'accepted', 'rejected')),
  constraint deep_cut_reviews_reviewer check (reviewer is null or reviewer in ('ai', 'staff'))
);

create index if not exists deep_cut_reviews_pending_idx
  on public.deep_cut_reviews (first_seen) where verdict = 'pending';

-- The keys the AI judge presents, as SHA-256 hashes. Empty means no judge: an
-- unknown spelling then waits for staff.
create table if not exists public.deep_cut_judge_keys (
  key_hash   bytea primary key,
  label      text not null,
  created_at timestamptz not null default now()
);

-- Each day's questions, chosen once.
create table if not exists public.deep_cut_days (
  day          integer primary key,
  question_ids smallint[] not null,
  created_at   timestamptz not null default now(),
  constraint deep_cut_days_size check (cardinality(question_ids) = 7)
);

create table if not exists public.deep_cut_runs (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid unique references public.game_sessions (id) on delete cascade,
  user_id      uuid references auth.users (id) on delete cascade,
  mode         text not null,
  day          integer,
  question_ids smallint[] not null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  constraint deep_cut_runs_mode check (mode in ('daily', 'unlimited', 'archive')),
  constraint deep_cut_runs_size check (cardinality(question_ids) = 7),
  constraint deep_cut_runs_daily check ((mode = 'unlimited') = (day is null))
);

-- One daily run per signed-in player per day: a fresh session continues it.
create unique index if not exists deep_cut_runs_daily_once
  on public.deep_cut_runs (user_id, day) where mode = 'daily' and user_id is not null;

create table if not exists public.deep_cut_turns (
  run_id       uuid not null references public.deep_cut_runs (id) on delete cascade,
  position     smallint not null,
  question_id  smallint not null references public.deep_cut_questions (id) on delete cascade,
  shown_at     timestamptz not null default now(),
  submitted_at timestamptz,
  raw          text,
  key          text,
  answer_id    integer references public.deep_cut_answers (id) on delete set null,
  verdict      text,
  points       smallint not null default 0,
  primary key (run_id, position),
  constraint deep_cut_turns_position check (position between 0 and 6),
  constraint deep_cut_turns_raw check (raw is null or char_length(raw) <= 60),
  constraint deep_cut_turns_verdict check (
    verdict is null or verdict in ('correct', 'wrong', 'unverified', 'timeout', 'skipped')),
  constraint deep_cut_turns_points check (points in (0, 10, 20, 40, 60, 80, 100)),
  constraint deep_cut_turns_correct check ((verdict = 'correct') = (points > 0))
);

create index if not exists deep_cut_turns_answer_idx
  on public.deep_cut_turns (question_id, answer_id) where verdict is not null;

-- Nothing here is readable or writable from a client: the functions below are the
-- only way in, and they hand out a question only when its clock starts.
alter table public.deep_cut_questions enable row level security;
alter table public.deep_cut_answers enable row level security;
alter table public.deep_cut_spellings enable row level security;
alter table public.deep_cut_reviews enable row level security;
alter table public.deep_cut_judge_keys enable row level security;
alter table public.deep_cut_days enable row level security;
alter table public.deep_cut_runs enable row level security;
alter table public.deep_cut_turns enable row level security;

revoke all on public.deep_cut_questions, public.deep_cut_answers, public.deep_cut_spellings,
  public.deep_cut_reviews, public.deep_cut_judge_keys, public.deep_cut_days,
  public.deep_cut_runs, public.deep_cut_turns
  from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Matching an answer
-- ─────────────────────────────────────────────────────────────────────────────

-- The normalised key of a spelling: lower case, accents folded, '&' read as
-- 'and' ('+' as 'plus', '#' as 'sharp', so C, C++ and C# differ), a leading article dropped, and everything but letters and digits removed.
-- "The Rolls-Royce", "rolls royce" and "ROLLSROYCE" are one key. Mirrored by
-- `answerKey` in src/lib/games/deep-cut.ts and scripts/generate-deep-cut-bank.mjs.
create or replace function public.deep_cut_key(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text;
begin
  if p_text is null then
    return '';
  end if;
  v := lower(p_text);
  v := replace(replace(replace(replace(v, 'ß', 'ss'), 'æ', 'ae'), 'œ', 'oe'), 'ø', 'o');
  v := replace(replace(replace(v, '&', ' and '), '+', 'plus'), '#', 'sharp');
  v := translate(v,
    'áàâäãåāăąçćčďéèêëēėęěíìîïīįłñńňóòôöõōőřśšşťúùûüūůűųýÿžźżğı',
    'aaaaaaaaacccdeeeeeeeeiiiiiilnnnooooooorsssstuuuuuuuuyyzzzgi');
  v := regexp_replace(v, '[^a-z0-9]+', ' ', 'g');
  v := btrim(v);
  v := regexp_replace(v, '^(the|a|an) ', '');
  return replace(v, ' ', '');
end;
$$;

comment on function public.deep_cut_key(text) is
  'A Deep Cut spelling as its matching key: lower case, accents folded, & as and, a leading the/a/an dropped, only a–z and 0–9 kept.';

-- Optimal string alignment distance (Levenshtein plus adjacent transpositions),
-- giving up as soon as it must exceed p_max.
create or replace function public.deep_cut_distance(p_a text, p_b text, p_max integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  la integer := char_length(p_a);
  lb integer := char_length(p_b);
  prev2 integer[];
  prev integer[];
  cur integer[];
  i integer;
  j integer;
  cost integer;
  best integer;
begin
  if abs(la - lb) > p_max then
    return p_max + 1;
  end if;
  if la = 0 or lb = 0 then
    return greatest(la, lb);
  end if;
  prev := array(select generate_series(0, lb));
  prev2 := prev;
  for i in 1..la loop
    cur := array[i] || array_fill(0, array[lb]);
    best := i;
    for j in 1..lb loop
      cost := case when substr(p_a, i, 1) = substr(p_b, j, 1) then 0 else 1 end;
      cur[j + 1] := least(prev[j + 1] + 1, cur[j] + 1, prev[j] + cost);
      if i > 1 and j > 1
         and substr(p_a, i, 1) = substr(p_b, j - 1, 1)
         and substr(p_a, i - 1, 1) = substr(p_b, j, 1) then
        cur[j + 1] := least(cur[j + 1], prev2[j - 1] + 1);
      end if;
      best := least(best, cur[j + 1]);
    end loop;
    if best > p_max then
      return p_max + 1;
    end if;
    prev2 := prev;
    prev := cur;
  end loop;
  return prev[lb + 1];
end;
$$;

-- How many typos a key of this length forgives: none up to four characters (so
-- "Iran" is never "Iraq"), one up to nine, two from ten.
create or replace function public.deep_cut_typo_allowance(p_key text)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case when char_length(p_key) < 5 then 0
              when char_length(p_key) < 10 then 1
              else 2 end
$$;

-- An answer for a key, and how it matched: exact, plural, typo; or rejected (a
-- review refused it), ambiguous (two answers equally close) or unknown.
create or replace function public.deep_cut_lookup(
  p_question_id smallint,
  p_key         text,
  out answer_id integer,
  out kind      text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_allow integer;
  v_best  integer;
  v_count integer;
begin
  if p_key is null or p_key = '' then
    kind := 'unknown';
    return;
  end if;

  select s.answer_id into answer_id
    from public.deep_cut_spellings s
   where s.question_id = p_question_id and s.key = p_key;
  if found then
    kind := 'exact';
    return;
  end if;

  if exists (
    select 1 from public.deep_cut_reviews r
     where r.question_id = p_question_id and r.key = p_key and r.verdict = 'rejected'
  ) then
    kind := 'rejected';
    answer_id := null;
    return;
  end if;

  -- A plural of a listed answer ("grapes", "peaches").
  select s.answer_id into answer_id
    from public.deep_cut_spellings s
   where s.question_id = p_question_id
     and char_length(p_key) > 3
     and ((p_key like '%s' and s.key = left(p_key, -1))
       or (p_key like '%es' and s.key = left(p_key, -2)))
   order by char_length(s.key) desc
   limit 1;
  if found then
    kind := 'plural';
    return;
  end if;

  v_allow := public.deep_cut_typo_allowance(p_key);
  if v_allow > 0 then
    -- The closest spelling that starts with the same letter, if exactly one answer
    -- is that close.
    with candidates as (
      select s.answer_id,
             public.deep_cut_distance(p_key, s.key, v_allow) as distance
        from public.deep_cut_spellings s
       where s.question_id = p_question_id
         and left(s.key, 1) = left(p_key, 1)
         and char_length(s.key) >= 5
         and abs(char_length(s.key) - char_length(p_key)) <= v_allow
    ), close as (
      select c.answer_id, min(c.distance) as distance
        from candidates c
       where c.distance <= v_allow
       group by c.answer_id
    )
    select min(distance), count(*) filter (where distance = (select min(distance) from close))
      into v_best, v_count
      from close;

    if v_best is not null then
      if v_count = 1 then
        select c.answer_id into answer_id
          from (
            select s.answer_id, public.deep_cut_distance(p_key, s.key, v_allow) as distance
              from public.deep_cut_spellings s
             where s.question_id = p_question_id
               and left(s.key, 1) = left(p_key, 1)
               and char_length(s.key) >= 5
               and abs(char_length(s.key) - char_length(p_key)) <= v_allow
          ) c
         where c.distance = v_best
         limit 1;
        kind := 'typo';
        return;
      end if;
      kind := 'ambiguous';
      answer_id := null;
      return;
    end if;
  end if;

  kind := 'unknown';
  answer_id := null;
end;
$$;

comment on function public.deep_cut_lookup(smallint, text) is
  'Matches a Deep Cut key to an answer: exact spelling, then a cached rejection, then a plural, then a unique closest spelling within the typo allowance (same first letter).';

revoke all on function public.deep_cut_key(text) from public;
revoke all on function public.deep_cut_distance(text, text, integer) from public;
revoke all on function public.deep_cut_typo_allowance(text) from public;
revoke all on function public.deep_cut_lookup(smallint, text) from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Loading the bank
-- ─────────────────────────────────────────────────────────────────────────────

-- Upserts one question and its curated answers from the generated bank migration:
-- `p_answers` is [{"name": "California", "tier": 1, "aliases": ["CA"]}, …]. An
-- answer a reviewer added (source ai or staff) is kept; a curated answer no longer
-- in the bank is removed, with its spellings.
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
    insert into public.deep_cut_answers (question_id, canonical, tier, source)
    values (v_question, v_entry->>'name', (v_entry->>'tier')::smallint, 'curated')
    on conflict (question_id, canonical) do update
      set tier = excluded.tier, source = 'curated'
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
-- Choosing questions
-- ─────────────────────────────────────────────────────────────────────────────

-- The UTC day number now. A player's own day is always within one of it.
create or replace function public.deep_cut_utc_day()
returns integer
language sql
stable
set search_path = ''
as $$ select (extract(epoch from now()) / 86400)::bigint::integer $$;

-- A seeded shuffle of p_ids, the first p_count kept: Fisher–Yates driven by the
-- LCG the other games deal with.
create or replace function public.deep_cut_shuffle(p_ids smallint[], p_seed bigint, p_count integer)
returns smallint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_ids   smallint[] := p_ids;
  v_state bigint := ((p_seed % 4294967296) + 4294967296) % 4294967296;
  v_n     integer := coalesce(array_length(p_ids, 1), 0);
  v_i     integer;
  v_j     integer;
  v_tmp   smallint;
begin
  if v_state = 0 then
    v_state := 2654435769;
  end if;
  for v_i in reverse v_n..2 loop
    v_state := (v_state * 1664525 + 1013904223) % 4294967296;
    v_j := (v_state % v_i)::integer + 1;
    v_tmp := v_ids[v_i];
    v_ids[v_i] := v_ids[v_j];
    v_ids[v_j] := v_tmp;
  end loop;
  return v_ids[1:least(p_count, v_n)];
end;
$$;

-- A day's seven questions: chosen the first time anyone needs them, then fixed.
-- Questions used in the days just before are left out: six days, or fewer when the
-- bank is too small to leave seven questions after that many (48 questions: five).
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

  select least(6, greatest(0, count(*)::integer / 7 - 1)) into v_window
    from public.deep_cut_questions q where q.active;

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

-- Every question in a daily set somebody could be playing right now: the UTC day
-- and the one either side of it.
create or replace function public.deep_cut_live_questions()
returns smallint[]
language sql
set search_path = ''
as $$
  select array(
    select distinct unnest(public.deep_cut_day_questions(d))
      from generate_series(public.deep_cut_utc_day() - 1, public.deep_cut_utc_day() + 1) d
  )
$$;

revoke all on function public.deep_cut_utc_day() from public;
revoke all on function public.deep_cut_shuffle(smallint[], bigint, integer) from public;
revoke all on function public.deep_cut_day_questions(integer) from public;
revoke all on function public.deep_cut_live_questions() from public;

-- ─────────────────────────────────────────────────────────────────────────────
-- Runs and turns
-- ─────────────────────────────────────────────────────────────────────────────

-- The run with this id or this daily session's id, if the caller may play it:
-- their own, or a guest run for a guest. A daily session's run is created on its
-- first question, continuing a signed-in player's earlier run of the same day.
create or replace function public.deep_cut_claim_run(p_id uuid)
returns public.deep_cut_runs
language plpgsql
set search_path = ''
as $$
declare
  v_user    uuid := auth.uid();
  v_run     public.deep_cut_runs;
  v_session public.game_sessions;
  v_game    public.games;
begin
  if p_id is null then
    return null;
  end if;

  select * into v_run from public.deep_cut_runs r
   where r.id = p_id or r.session_id = p_id
   for update;
  if found then
    if v_run.user_id is distinct from v_user then
      return null;
    end if;
    return v_run;
  end if;

  select * into v_session from public.game_sessions s where s.id = p_id for update;
  if not found or v_session.user_id is distinct from v_user then
    return null;
  end if;
  select * into v_game from public.games g where g.id = v_session.game_id;
  if v_game.runtime is distinct from 'deep-cut'
     or v_session.rules_version is distinct from public.deep_cut_rules_version() then
    return null;
  end if;

  if v_user is not null then
    -- The same player, the same day, a new session: carry the run over.
    select * into v_run from public.deep_cut_runs r
     where r.user_id = v_user and r.mode = 'daily' and r.day = v_session.seed::integer
     for update;
    if found then
      update public.deep_cut_runs r
         set session_id = v_session.id,
             expires_at = greatest(r.expires_at, v_session.expires_at)
       where r.id = v_run.id
      returning * into v_run;
      return v_run;
    end if;
  end if;

  insert into public.deep_cut_runs (id, session_id, user_id, mode, day, question_ids, expires_at)
  values (v_session.id, v_session.id, v_user, 'daily', v_session.seed::integer,
          public.deep_cut_day_questions(v_session.seed::integer), v_session.expires_at)
  returning * into v_run;
  return v_run;
end;
$$;

revoke all on function public.deep_cut_claim_run(uuid) from public;

-- Whether a run can still be played: not expired, and a daily run's session not
-- yet completed.
create or replace function public.deep_cut_run_state(p_run public.deep_cut_runs)
returns text
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_run.session_id is not null and exists (
    select 1 from public.game_sessions s
     where s.id = p_run.session_id and (s.completed_at is not null or s.abandoned_at is not null)
  ) then
    return 'closed';
  end if;
  if now() >= p_run.expires_at then
    return 'expired';
  end if;
  return 'live';
end;
$$;

revoke all on function public.deep_cut_run_state(public.deep_cut_runs) from public;

-- Settles a turn that has no verdict: an answer held back for review is judged
-- with whatever the bank and the reviews now say; no answer at all is out of time
-- (or skipped, when the run is being ended early).
create or replace function public.deep_cut_settle(p_run_id uuid, p_position smallint, p_force boolean)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_turn   public.deep_cut_turns;
  v_lookup record;
  v_tier   smallint;
  v_due    timestamptz;
begin
  select * into v_turn from public.deep_cut_turns t
   where t.run_id = p_run_id and t.position = p_position
   for update;
  if not found or v_turn.verdict is not null then
    return;
  end if;

  v_due := v_turn.shown_at
    + make_interval(secs => public.deep_cut_answer_seconds() + public.deep_cut_grace_seconds());

  if v_turn.submitted_at is null then
    if now() < v_due and not p_force then
      return;
    end if;
    update public.deep_cut_turns t
       set verdict = case when now() < v_due then 'skipped' else 'timeout' end
     where t.run_id = p_run_id and t.position = p_position;
    return;
  end if;

  select * into v_lookup from public.deep_cut_lookup(v_turn.question_id, v_turn.key);
  if v_lookup.answer_id is not null then
    select a.tier into v_tier from public.deep_cut_answers a where a.id = v_lookup.answer_id;
    update public.deep_cut_turns t
       set verdict = 'correct', answer_id = v_lookup.answer_id,
           points = public.deep_cut_tier_points(v_tier)
     where t.run_id = p_run_id and t.position = p_position;
  elsif v_lookup.kind in ('rejected', 'ambiguous') then
    update public.deep_cut_turns t set verdict = 'wrong'
     where t.run_id = p_run_id and t.position = p_position;
  else
    -- Nobody has judged this spelling yet: it scores nothing now and waits for a
    -- reviewer, whose verdict every later player gets.
    insert into public.deep_cut_reviews (question_id, key, sample)
    values (v_turn.question_id, v_turn.key, v_turn.raw)
    on conflict (question_id, key) do update set seen = public.deep_cut_reviews.seen + 1;
    update public.deep_cut_turns t set verdict = 'unverified'
     where t.run_id = p_run_id and t.position = p_position;
  end if;
end;
$$;

revoke all on function public.deep_cut_settle(uuid, smallint, boolean) from public;

-- A settled turn as the client sees it.
create or replace function public.deep_cut_turn_view(p_run public.deep_cut_runs, p_position smallint)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_turn      public.deep_cut_turns;
  v_answer    public.deep_cut_answers;
  v_total     bigint;
  v_same      bigint;
  v_common    text;
  v_deepest   text;
begin
  select * into v_turn from public.deep_cut_turns t
   where t.run_id = p_run.id and t.position = p_position;
  if not found then
    return null;
  end if;

  if v_turn.answer_id is not null then
    select * into v_answer from public.deep_cut_answers a where a.id = v_turn.answer_id;
    select count(*), count(*) filter (where t.answer_id = v_turn.answer_id)
      into v_total, v_same
      from public.deep_cut_turns t
     where t.question_id = v_turn.question_id and t.verdict in ('correct', 'wrong', 'unverified');
  end if;

  -- What most people say is no secret; the rarest answers are shown only in
  -- practice, so a daily player can't pass today's deep cuts on.
  select a.canonical into v_common from public.deep_cut_answers a
   where a.question_id = v_turn.question_id and a.tier = 1
   order by a.id limit 1;
  if p_run.mode <> 'daily' then
    select string_agg(x.canonical, ', ') into v_deepest from (
      select a.canonical from public.deep_cut_answers a
       where a.question_id = v_turn.question_id
         and a.tier = (select max(b.tier) from public.deep_cut_answers b
                        where b.question_id = v_turn.question_id)
       order by md5(a.canonical || p_run.id::text) limit 3
    ) x;
  end if;

  return jsonb_build_object(
    'position', v_turn.position,
    'verdict', v_turn.verdict,
    'answer', v_turn.raw,
    'canonical', v_answer.canonical,
    'answerId', coalesce(v_turn.answer_id, 0),
    'tier', v_answer.tier,
    'points', v_turn.points,
    'sharePercent', case when v_total >= 20 then round(100.0 * v_same / v_total)::integer end,
    'commonAnswer', v_common,
    'deepestAnswers', v_deepest
  );
end;
$$;

revoke all on function public.deep_cut_turn_view(public.deep_cut_runs, smallint) from public;

-- Starts a question's clock and hands over its prompt. Questions come in order: the
-- next one is dealt only once the one before is answered or out of time. Asking for
-- a question already dealt returns it again, with its original deadline.
create or replace function public.deep_cut_reveal(p_run_id uuid, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run      public.deep_cut_runs;
  v_state    text;
  v_turn     public.deep_cut_turns;
  v_question public.deep_cut_questions;
  v_dealt    integer;
begin
  if p_position is null or p_position < 0 or p_position >= public.deep_cut_questions_per_run() then
    return jsonb_build_object('outcome', 'invalid_position');
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
    select count(*) into v_dealt from public.deep_cut_turns t where t.run_id = v_run.id;
    if p_position <> v_dealt then
      return jsonb_build_object('outcome', 'out_of_order', 'next', v_dealt);
    end if;
    if v_dealt > 0 then
      perform public.deep_cut_settle(v_run.id, (v_dealt - 1)::smallint, true);
    end if;
    insert into public.deep_cut_turns (run_id, position, question_id)
    values (v_run.id, p_position, v_run.question_ids[p_position + 1])
    returning * into v_turn;
  end if;

  select * into v_question from public.deep_cut_questions q where q.id = v_turn.question_id;

  return jsonb_build_object(
    'outcome', 'shown',
    'runId', v_run.id,
    'mode', v_run.mode,
    'day', v_run.day,
    'position', v_turn.position,
    'total', public.deep_cut_questions_per_run(),
    'category', v_question.category,
    'prompt', v_question.prompt,
    'shownAt', v_turn.shown_at,
    'deadline', v_turn.shown_at + make_interval(secs => public.deep_cut_answer_seconds()),
    'seconds', public.deep_cut_answer_seconds(),
    -- What is left on the clock by the server's own time, so a device whose clock
    -- is wrong still counts down correctly.
    'remainingMs', greatest(0, (extract(epoch from (v_turn.shown_at
      + make_interval(secs => public.deep_cut_answer_seconds()) - now())) * 1000)::bigint),
    'settled', case when v_turn.verdict is not null
                    then public.deep_cut_turn_view(v_run, v_turn.position) end
  );
end;
$$;

comment on function public.deep_cut_reveal(uuid, integer) is
  'Deals Deep Cut question p_position of a run (or a daily session) and starts its 25-second clock. In order only; a dealt question is returned again with its original deadline.';

-- Judges an answer to a dealt question and records it. One answer per question,
-- within its clock. With p_final false, a spelling nobody has judged yet is held
-- (outcome `unknown`) so the AI judge can review it; the next call with p_final
-- true — or the next question — settles it with whatever the review decided.
create or replace function public.deep_cut_answer(
  p_run_id   uuid,
  p_position integer,
  p_answer   text,
  p_final    boolean default true
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
  v_due    timestamptz;
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
   where t.run_id = v_run.id and t.position = p_position
   for update;
  if not found then
    return jsonb_build_object('outcome', 'not_shown');
  end if;

  v_key := public.deep_cut_key(v_raw);
  v_due := v_turn.shown_at
    + make_interval(secs => public.deep_cut_answer_seconds() + public.deep_cut_grace_seconds());

  if v_turn.verdict is not null then
    return jsonb_build_object('outcome', 'scored', 'turn', public.deep_cut_turn_view(v_run, v_turn.position));
  end if;

  if v_turn.submitted_at is not null then
    -- The second half of a held answer: it must be the same answer.
    if v_turn.key is distinct from v_key then
      return jsonb_build_object('outcome', 'already_answered');
    end if;
  else
    if now() > v_due then
      perform public.deep_cut_settle(v_run.id, v_turn.position, true);
      return jsonb_build_object('outcome', 'scored', 'turn', public.deep_cut_turn_view(v_run, v_turn.position));
    end if;

    if v_raw is null or v_key = '' then
      update public.deep_cut_turns t
         set submitted_at = now(), raw = v_raw, verdict = 'skipped'
       where t.run_id = v_run.id and t.position = v_turn.position;
      return jsonb_build_object('outcome', 'scored', 'turn', public.deep_cut_turn_view(v_run, v_turn.position));
    end if;

    update public.deep_cut_turns t
       set submitted_at = now(), raw = v_raw, key = v_key
     where t.run_id = v_run.id and t.position = v_turn.position;
  end if;

  if not coalesce(p_final, true) then
    select * into v_lookup from public.deep_cut_lookup(v_turn.question_id, v_key);
    if v_lookup.kind = 'unknown' then
      return jsonb_build_object('outcome', 'unknown', 'position', v_turn.position);
    end if;
  end if;

  perform public.deep_cut_settle(v_run.id, v_turn.position, true);
  return jsonb_build_object('outcome', 'scored', 'turn', public.deep_cut_turn_view(v_run, v_turn.position));
end;
$$;

comment on function public.deep_cut_answer(uuid, integer, text, boolean) is
  'Judges and records one Deep Cut answer within its clock: an exact, plural or near (typo) match to the bank scores its tier; a rejected spelling is wrong; an unjudged one is held for review when p_final is false, and otherwise scores nothing and is queued.';

revoke all on function public.deep_cut_reveal(uuid, integer) from public;
revoke all on function public.deep_cut_answer(uuid, integer, text, boolean) from public;
grant execute on function public.deep_cut_reveal(uuid, integer) to anon, authenticated;
grant execute on function public.deep_cut_answer(uuid, integer, text, boolean) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Practice: Unlimited and Archive
-- ─────────────────────────────────────────────────────────────────────────────

-- An unranked run. Unlimited deals seven questions at random; Archive deals a past
-- day's set, from thirty days back to two days ago (yesterday is still today
-- somewhere). Neither deals a question in a daily set that is live anywhere: an
-- archived question that is back in a live set is swapped for one that isn't, and
-- `swapped` says how many were.
create or replace function public.deep_cut_start_practice(p_mode text, p_day integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := auth.uid();
  v_live  smallint[];
  v_ids   smallint[];
  v_today integer := public.deep_cut_utc_day();
  v_run   public.deep_cut_runs;
  v_pool  smallint[];
  v_swaps integer := 0;
  v_index integer;
begin
  if p_mode is null or p_mode not in ('unlimited', 'archive') then
    return jsonb_build_object('outcome', 'invalid_mode');
  end if;

  v_live := public.deep_cut_live_questions();

  if p_mode = 'archive' then
    if p_day is null or p_day > v_today - 2 or p_day < v_today - 30 then
      return jsonb_build_object('outcome', 'not_available');
    end if;
    v_ids := public.deep_cut_day_questions(p_day);
    select coalesce(array_agg(q.id order by random()), '{}') into v_pool
      from public.deep_cut_questions q
     where q.active and not (q.id = any(v_live)) and not (q.id = any(v_ids));
    for v_index in 1..7 loop
      if v_ids[v_index] = any(v_live) then
        v_swaps := v_swaps + 1;
        if v_swaps > coalesce(array_length(v_pool, 1), 0) then
          return jsonb_build_object('outcome', 'not_available');
        end if;
        v_ids[v_index] := v_pool[v_swaps];
      end if;
    end loop;
  else
    select coalesce(array_agg(q.id order by random()), '{}') into v_pool
      from public.deep_cut_questions q
     where q.active and not (q.id = any(v_live));
    if coalesce(array_length(v_pool, 1), 0) < 7 then
      return jsonb_build_object('outcome', 'not_available');
    end if;
    v_ids := v_pool[1:7];
  end if;

  insert into public.deep_cut_runs (user_id, mode, day, question_ids, expires_at)
  values (v_user, p_mode, case when p_mode = 'archive' then p_day end, v_ids, now() + interval '2 hours')
  returning * into v_run;

  return jsonb_build_object(
    'outcome', 'started',
    'runId', v_run.id,
    'mode', v_run.mode,
    'day', v_run.day,
    'swapped', v_swaps,
    'total', public.deep_cut_questions_per_run(),
    'expiresAt', v_run.expires_at
  );
end;
$$;

-- Which past days the archive can deal now: thirty days back to two days ago.
create or replace function public.deep_cut_archive_days()
returns integer[]
language sql
stable
security definer
set search_path = ''
as $$
  select array(select d from generate_series(public.deep_cut_utc_day() - 2,
                                             public.deep_cut_utc_day() - 30, -1) d)
$$;

-- A finished practice run, summed: the client shows it, nothing records it.
create or replace function public.deep_cut_practice_summary(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_run      public.deep_cut_runs;
  v_position smallint;
  v_turns    jsonb := '[]'::jsonb;
  v_total    integer := 0;
begin
  v_run := public.deep_cut_claim_run(p_run_id);
  if v_run.id is null or v_run.mode = 'daily' then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  for v_position in
    select t.position from public.deep_cut_turns t where t.run_id = v_run.id order by t.position
  loop
    perform public.deep_cut_settle(v_run.id, v_position, true);
    v_turns := v_turns || public.deep_cut_turn_view(v_run, v_position);
  end loop;
  select coalesce(sum(t.points), 0) into v_total from public.deep_cut_turns t where t.run_id = v_run.id;
  -- Ended: nothing more can be dealt.
  update public.deep_cut_runs r set expires_at = least(r.expires_at, now()) where r.id = v_run.id;
  return jsonb_build_object('outcome', 'finished', 'points', v_total, 'turns', v_turns);
end;
$$;

revoke all on function public.deep_cut_start_practice(text, integer) from public;
revoke all on function public.deep_cut_archive_days() from public;
revoke all on function public.deep_cut_practice_summary(uuid) from public;
grant execute on function public.deep_cut_start_practice(text, integer) to anon, authenticated;
grant execute on function public.deep_cut_archive_days() to anon, authenticated;
grant execute on function public.deep_cut_practice_summary(uuid) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The AI judge's two calls
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.deep_cut_judge_allowed(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_key is not null and char_length(p_key) >= 32 and exists (
    select 1 from public.deep_cut_judge_keys k
     where k.key_hash = sha256(convert_to(p_key, 'UTF8'))
  )
$$;

revoke all on function public.deep_cut_judge_allowed(text) from public;

-- What the judge needs to rule on a held answer: the prompt, the answer as typed,
-- and the bank's own answers (so it can say "that's another name for X").
create or replace function public.deep_cut_judge_context(p_judge_key text, p_run_id uuid, p_position integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_turn     public.deep_cut_turns;
  v_question public.deep_cut_questions;
begin
  if not public.deep_cut_judge_allowed(p_judge_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select t.* into v_turn from public.deep_cut_turns t
    join public.deep_cut_runs r on r.id = t.run_id
   where (r.id = p_run_id or r.session_id = p_run_id) and t.position = p_position;
  if not found or v_turn.submitted_at is null or v_turn.verdict is not null then
    return jsonb_build_object('outcome', 'not_held');
  end if;
  select * into v_question from public.deep_cut_questions q where q.id = v_turn.question_id;
  return jsonb_build_object(
    'outcome', 'held',
    'questionId', v_question.id,
    'prompt', v_question.prompt,
    'category', v_question.category,
    'answer', v_turn.raw,
    'key', v_turn.key,
    'known', (select coalesce(jsonb_agg(a.canonical order by a.tier, a.canonical), '[]'::jsonb)
                from public.deep_cut_answers a where a.question_id = v_question.id)
  );
end;
$$;

-- Records a ruling on a spelling, once: it becomes part of the bank (an accepted
-- spelling of a known answer, or a new answer at a tier from 2 to 5 — never the
-- surface, never the abyss) or a cached rejection. A spelling already judged keeps
-- its first verdict.
create or replace function public.deep_cut_record_review(
  p_judge_key   text,
  p_question_id integer,
  p_key         text,
  p_sample      text,
  p_verdict     text,
  p_canonical   text,
  p_tier        integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer   integer;
  v_question smallint := p_question_id::smallint;
  v_name     text := nullif(btrim(coalesce(p_canonical, '')), '');
  v_name_key text;
begin
  if not public.deep_cut_judge_allowed(p_judge_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9]{1,60}$' or p_verdict not in ('accepted', 'rejected') then
    return 'invalid';
  end if;
  if exists (select 1 from public.deep_cut_spellings s where s.question_id = v_question and s.key = p_key)
     or exists (select 1 from public.deep_cut_reviews r
                 where r.question_id = v_question and r.key = p_key and r.verdict <> 'pending') then
    return 'already_judged';
  end if;

  if p_verdict = 'accepted' then
    if v_name is null or char_length(v_name) > 60 then
      return 'invalid';
    end if;
    v_name_key := public.deep_cut_key(v_name);
    select s.answer_id into v_answer from public.deep_cut_spellings s
     where s.question_id = v_question and s.key = v_name_key;
    if not found then
      insert into public.deep_cut_answers (question_id, canonical, tier, source)
      values (v_question, v_name, least(greatest(coalesce(p_tier, 4), 2), 5), 'ai')
      on conflict (question_id, canonical) do update set canonical = excluded.canonical
      returning id into v_answer;
      insert into public.deep_cut_spellings (question_id, key, answer_id)
      values (v_question, v_name_key, v_answer)
      on conflict (question_id, key) do nothing;
    end if;
    insert into public.deep_cut_spellings (question_id, key, answer_id)
    values (v_question, p_key, v_answer)
    on conflict (question_id, key) do nothing;
  end if;

  insert into public.deep_cut_reviews (question_id, key, sample, verdict, answer_id, reviewer, reviewed_at)
  values (v_question, p_key, left(coalesce(nullif(btrim(p_sample), ''), p_key), 60),
          p_verdict, v_answer, 'ai', now())
  on conflict (question_id, key) do update
    set verdict = excluded.verdict, answer_id = excluded.answer_id,
        reviewer = excluded.reviewer, reviewed_at = excluded.reviewed_at;
  return p_verdict;
end;
$$;

revoke all on function public.deep_cut_judge_context(text, uuid, integer) from public;
revoke all on function public.deep_cut_record_review(text, integer, text, text, text, text, integer) from public;
grant execute on function public.deep_cut_judge_context(text, uuid, integer) to anon, authenticated;
grant execute on function public.deep_cut_record_review(text, integer, text, text, text, text, integer) to anon, authenticated;

comment on function public.deep_cut_record_review(text, integer, text, text, text, text, integer) is
  'The AI judge''s ruling on a spelling the Deep Cut bank did not know, recorded once and cached for every later player. Needs a judge key whose SHA-256 is in deep_cut_judge_keys.';

-- Staff's ruling on a queued spelling, from the database console (no client may
-- call it): accept it as another spelling of an answer or as a new answer at any
-- tier, or reject it. Unlike the AI judge's, a staff ruling may replace an earlier
-- one, and may place an answer anywhere from the surface to the abyss.
--
--   select * from public.deep_cut_reviews where verdict = 'pending' order by seen desc;
--   select public.deep_cut_staff_review(12, 'salak', 'accepted', 'Snake fruit', 5);
create or replace function public.deep_cut_staff_review(
  p_question_id integer,
  p_key         text,
  p_verdict     text,
  p_canonical   text default null,
  p_tier        integer default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question smallint := p_question_id::smallint;
  v_name     text := nullif(btrim(coalesce(p_canonical, '')), '');
  v_answer   integer;
  v_sample   text;
begin
  if p_verdict not in ('accepted', 'rejected') or p_key !~ '^[a-z0-9]{1,60}$' then
    raise exception 'a ruling is accepted or rejected, on a key' using errcode = '22023';
  end if;
  select r.sample into v_sample from public.deep_cut_reviews r
   where r.question_id = v_question and r.key = p_key;

  if p_verdict = 'accepted' then
    if v_name is null or p_tier is null or p_tier not between 1 and 6 then
      raise exception 'an accepted spelling needs a name and a tier from 1 to 6' using errcode = '22023';
    end if;
    select s.answer_id into v_answer from public.deep_cut_spellings s
     where s.question_id = v_question and s.key = public.deep_cut_key(v_name);
    if not found then
      insert into public.deep_cut_answers (question_id, canonical, tier, source)
      values (v_question, v_name, p_tier, 'staff')
      returning id into v_answer;
      insert into public.deep_cut_spellings (question_id, key, answer_id)
      values (v_question, public.deep_cut_key(v_name), v_answer);
    end if;
    insert into public.deep_cut_spellings (question_id, key, answer_id)
    values (v_question, p_key, v_answer)
    on conflict (question_id, key) do update set answer_id = excluded.answer_id;
  else
    delete from public.deep_cut_spellings s
     where s.question_id = v_question and s.key = p_key
       and exists (select 1 from public.deep_cut_answers a
                    where a.id = s.answer_id and a.source <> 'curated');
  end if;

  insert into public.deep_cut_reviews (question_id, key, sample, verdict, answer_id, reviewer, reviewed_at)
  values (v_question, p_key, coalesce(v_sample, p_key), p_verdict, v_answer, 'staff', now())
  on conflict (question_id, key) do update
    set verdict = excluded.verdict, answer_id = excluded.answer_id,
        reviewer = 'staff', reviewed_at = now();
  return p_verdict;
end;
$$;

revoke all on function public.deep_cut_staff_review(integer, text, text, text, integer) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Complete a daily run: gate, settle, compare, record
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The actions are the run's turns in order: the matched answer's id for a correct
-- turn, 0 otherwise. Ending early is allowed (an open question is skipped and the
-- rest are never dealt); the score is the sum of the recorded points, a tenth of
-- what the screen shows, so a perfect day verifies as 70 and displays as 700.

create or replace function public.complete_deep_cut_run(
  p_session_id  uuid,
  p_actions     integer[],
  p_score       bigint,
  p_duration_ms integer
)
returns public.play_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate     record;
  v_result   public.play_result;
  v_run      public.deep_cut_runs;
  v_turn     public.deep_cut_turns;
  v_index    integer := 0;
  v_correct  integer := 0;
  v_points   integer := 0;
  v_score    bigint;
begin
  select * into v_gate from public.speed_run_gate(
    p_session_id, p_actions, p_score, p_duration_ms,
    public.deep_cut_rules_version(), public.deep_cut_questions_per_run());
  if (v_gate.refusal).outcome is not null then
    return v_gate.refusal;
  end if;

  v_result.session_id := (v_gate.session).id;
  v_result.game_slug := (v_gate.game).slug;

  -- One ranked completion a day: the day is the seed.
  if (v_gate.session).user_id is not null and exists (
    select 1
      from public.game_sessions s
     where s.game_id = (v_gate.session).game_id
       and s.user_id = (v_gate.session).user_id
       and s.seed = (v_gate.session).seed
       and s.id <> (v_gate.session).id
       and s.completed_at is not null
  ) then
    v_result.outcome := 'already_played';
    return v_result;
  end if;

  select * into v_run from public.deep_cut_runs r where r.session_id = p_session_id for update;

  if found then
    for v_turn in select * from public.deep_cut_turns t where t.run_id = v_run.id order by t.position loop
      perform public.deep_cut_settle(v_run.id, v_turn.position, true);
    end loop;

    for v_turn in select * from public.deep_cut_turns t where t.run_id = v_run.id order by t.position loop
      v_index := v_index + 1;
      if v_index > coalesce(array_length(p_actions, 1), 0)
         or p_actions[v_index] is distinct from
            (case when v_turn.verdict = 'correct' then v_turn.answer_id else 0 end) then
        v_result.outcome := 'invalid_actions';
        return v_result;
      end if;
      v_points := v_points + v_turn.points;
      if v_turn.verdict = 'correct' then
        v_correct := v_correct + 1;
      end if;
    end loop;
  end if;

  if v_index <> coalesce(array_length(p_actions, 1), 0) then
    v_result.outcome := 'invalid_actions';
    return v_result;
  end if;

  v_score := v_points / 10;

  if p_score is distinct from v_score then
    v_result.outcome := 'score_mismatch';
    v_result.score := v_score;
    return v_result;
  end if;

  return public.speed_run_finish(
    v_gate.session, v_gate.game, v_gate.digest, v_score,
    0, v_gate.elapsed, v_correct, v_index, p_duration_ms);
end;
$$;

comment on function public.complete_deep_cut_run(uuid, integer[], bigint, integer) is
  'Verifies a day''s Deep Cut run against the answers the database judged while it was played, and records it: the sum of each answer''s rarity points. One ranked completion per player per day (already_played). The claim is compared, never trusted.';

revoke all on function public.complete_deep_cut_run(uuid, integer[], bigint, integer) from public;
grant execute on function public.complete_deep_cut_run(uuid, integer[], bigint, integer) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The start gate learns Deep Cut: a registry row and a daily seed
-- ─────────────────────────────────────────────────────────────────────────────

insert into public.game_runtimes (runtime, rules_version, max_actions, session_hours) values
  ('deep-cut', public.deep_cut_rules_version(), public.deep_cut_questions_per_run(), 2)
on conflict (runtime, rules_version) do update
  set max_actions   = excluded.max_actions,
      session_hours = excluded.session_hours;

-- The same function as `20261222120000_guesswork_sessions.sql`, with `deep-cut`
-- seeded by the player's day alongside the crossword and Guesswork.
create or replace function public.start_game_session(
  p_game_slug     text,
  p_rules_version text,
  p_client        text,
  p_time_zone     text
)
returns public.session_start
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_empty   public.session_start;
  v_game    public.games;
  v_user    uuid := auth.uid();
  v_client  text := nullif(btrim(coalesce(p_client, '')), '');
  v_session public.game_sessions;
  v_runtime public.game_runtimes;
  v_seed    bigint;
begin
  if p_game_slug is null or p_game_slug !~ '^[a-z0-9-]{2,48}$' then
    raise exception 'invalid game slug' using errcode = '22023';
  end if;
  if p_rules_version is null or p_rules_version !~ '^[a-z0-9-]{2,32}@[0-9]{1,4}$' then
    raise exception 'invalid rules version' using errcode = '22023';
  end if;
  if v_client is not null and char_length(v_client) > 40 then
    raise exception 'client is longer than 40 characters' using errcode = '22023';
  end if;

  select * into v_game
    from public.games g
   where g.slug = p_game_slug
     and g.status = 'published'
     and g.playable
     and g.runtime is not null;

  if not found then
    v_empty.outcome := 'not_playable';
    return v_empty;
  end if;

  select * into v_runtime
    from public.game_runtimes r
   where r.runtime = v_game.runtime
     and r.rules_version = p_rules_version;

  if not found then
    v_empty.outcome := 'unsupported_runtime';
    return v_empty;
  end if;

  -- The daily games' seed is the player's day: the crossword's, Guesswork's and
  -- Deep Cut's is the day number, and 7 Second's is that number hashed exactly as
  -- `seven_second_seed` hashes it.
  if v_game.runtime in ('crossword', 'guesswork', 'deep-cut') then
    v_seed := public.player_local_day(p_time_zone);
  elsif v_game.runtime = 'seven-second' then
    v_seed := public.player_local_day(p_time_zone) * 2654435761 + 7;
  end if;

  if v_seed is not null and v_user is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_game.id::text || ':' || v_user::text, 0)
    );

    if exists (
      select 1
        from public.game_sessions s
       where s.game_id = v_game.id
         and s.user_id = v_user
         and s.completed_at is not null
         and s.seed = v_seed
    ) then
      v_empty.outcome := 'already_played';
      return v_empty;
    end if;
  end if;

  if v_user is not null then
    update public.game_sessions s
       set abandoned_at = now()
     where s.game_id = v_game.id
       and s.user_id = v_user
       and s.completed_at is null
       and s.abandoned_at is null;
  end if;

  if v_seed is not null then
    insert into public.game_sessions (game_id, user_id, client, rules_version, seed)
    values (v_game.id, v_user, v_client, p_rules_version, v_seed)
    returning * into v_session;
  else
    insert into public.game_sessions (game_id, user_id, client, rules_version, expires_at)
    values (v_game.id, v_user, v_client, p_rules_version,
            now() + make_interval(hours => v_runtime.session_hours))
    returning * into v_session;
  end if;

  v_empty.outcome       := 'started';
  v_empty.id            := v_session.id;
  v_empty.game_slug     := v_game.slug;
  v_empty.rules_version := v_session.rules_version;
  v_empty.seed          := v_session.seed;
  v_empty.tile_count    := v_runtime.max_actions;
  v_empty.started_at    := v_session.started_at;
  v_empty.expires_at    := v_session.expires_at;
  v_empty.ranked        := v_session.user_id is not null;
  return v_empty;
end;
$$;

comment on function public.start_game_session(text, text, text, text) is
  'Issues a play session with a server-chosen seed. The caller identity is the verified token, never an argument. A daily game''s seed (the crossword, Guesswork, Deep Cut, 7 Second) follows the player''s own date.';

revoke all on function public.start_game_session(text, text, text, text) from public;
grant execute on function public.start_game_session(text, text, text, text) to anon, authenticated;
