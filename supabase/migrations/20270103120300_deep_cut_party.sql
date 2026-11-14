-- Deep Cut Party: hot potato, pass-and-play on one device.
--
-- Two to eight players share a phone. Each round deals one question; the phone
-- goes round the table and each player must name a correct answer nobody has
-- given yet this round before passing it on, while a hidden fuse burns down.
-- Whoever is holding it when it goes off is out; the last player in wins.
--
-- The bank still never leaves the database, so the server deals each round's
-- question and judges each answer (`deep_cut_party_answer`): a valid answer not
-- yet given this round is recorded and scores its tier; a repeat, a wrong answer
-- or one nobody has judged is refused and the player tries again. The fuse, the
-- turns and who is out live on the device — Party is unranked, like practice, and
-- records no score. Like practice it never deals a question live in a daily set.
--
-- A party may be played signed in or as a guest, as practice may. It lasts three
-- hours and at most 60 rounds.

create table if not exists public.deep_cut_parties (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users (id) on delete cascade,
  players      smallint not null,
  question_ids smallint[] not null default '{}',
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  constraint deep_cut_parties_players check (players between 2 and 8),
  constraint deep_cut_parties_rounds check (cardinality(question_ids) <= 60)
);

create table if not exists public.deep_cut_party_answers (
  party_id    uuid not null references public.deep_cut_parties (id) on delete cascade,
  round       smallint not null,
  answer_id   integer not null references public.deep_cut_answers (id) on delete cascade,
  question_id smallint not null references public.deep_cut_questions (id) on delete cascade,
  player      smallint not null,
  raw         text not null,
  tier        smallint not null,
  created_at  timestamptz not null default now(),
  -- One answer once per round: the second person to say it is refused.
  primary key (party_id, round, answer_id),
  constraint deep_cut_party_answers_round check (round between 0 and 59),
  constraint deep_cut_party_answers_player check (player between 0 and 7),
  constraint deep_cut_party_answers_raw check (char_length(raw) between 1 and 60)
);

alter table public.deep_cut_parties enable row level security;
alter table public.deep_cut_party_answers enable row level security;
revoke all on public.deep_cut_parties, public.deep_cut_party_answers from public, anon, authenticated;

create index if not exists deep_cut_parties_expiry_idx on public.deep_cut_parties (expires_at);

-- The party with this id, if the caller may play it: their own, or a guest party
-- for a guest. Expired parties are not found.
create or replace function public.deep_cut_claim_party(p_id uuid)
returns public.deep_cut_parties
language plpgsql
set search_path = ''
as $$
declare
  v_party public.deep_cut_parties;
begin
  select * into v_party from public.deep_cut_parties p where p.id = p_id for update;
  if not found or v_party.user_id is distinct from auth.uid() or now() >= v_party.expires_at then
    return null;
  end if;
  return v_party;
end;
$$;

revoke all on function public.deep_cut_claim_party(uuid) from public;

create or replace function public.deep_cut_party_start(p_players integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_party public.deep_cut_parties;
begin
  if p_players is null or p_players not between 2 and 8 then
    return jsonb_build_object('outcome', 'invalid_players');
  end if;
  insert into public.deep_cut_parties (user_id, players, expires_at)
  values (auth.uid(), p_players, now() + interval '3 hours')
  returning * into v_party;
  return jsonb_build_object(
    'outcome', 'started',
    'partyId', v_party.id,
    'players', v_party.players,
    'expiresAt', v_party.expires_at
  );
end;
$$;

-- The answers already given in a round, in the order they were given.
create or replace function public.deep_cut_party_used(p_party uuid, p_round smallint)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'player', pa.player, 'canonical', a.canonical, 'tier', pa.tier)
           order by pa.created_at), '[]'::jsonb)
    from public.deep_cut_party_answers pa
    join public.deep_cut_answers a on a.id = pa.answer_id
   where pa.party_id = p_party and pa.round = p_round
$$;

revoke all on function public.deep_cut_party_used(uuid, smallint) from public;

-- Deals round `p_round`: the next round gets a fresh question; asking again for
-- a round already dealt returns it, with the answers given so far.
create or replace function public.deep_cut_party_question(p_party_id uuid, p_round integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_party    public.deep_cut_parties;
  v_dealt    integer;
  v_question public.deep_cut_questions;
  v_next     smallint;
begin
  if p_round is null or p_round < 0 or p_round > 59 then
    return jsonb_build_object('outcome', 'invalid_round');
  end if;
  v_party := public.deep_cut_claim_party(p_party_id);
  if v_party.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  v_dealt := cardinality(v_party.question_ids);
  if p_round > v_dealt then
    return jsonb_build_object('outcome', 'out_of_order');
  end if;

  if p_round = v_dealt then
    select q.id into v_next
      from public.deep_cut_questions q
     where q.active
       and not (q.id = any(public.deep_cut_live_questions()))
       and not (q.id = any(v_party.question_ids))
     order by random()
     limit 1;
    if v_next is null then
      return jsonb_build_object('outcome', 'not_available');
    end if;
    update public.deep_cut_parties p
       set question_ids = p.question_ids || v_next
     where p.id = v_party.id
    returning * into v_party;
  end if;

  select * into v_question from public.deep_cut_questions q
   where q.id = v_party.question_ids[p_round + 1];
  return jsonb_build_object(
    'outcome', 'shown',
    'partyId', v_party.id,
    'round', p_round,
    'category', v_question.category,
    'prompt', v_question.prompt,
    'used', public.deep_cut_party_used(v_party.id, p_round::smallint)
  );
end;
$$;

-- One player's answer in a round. `result` is:
--   valid     — recorded: it scores `points` and the phone moves on;
--   repeat    — a correct answer someone already gave this round (`canonical`);
--   invalid   — not a correct answer;
--   ambiguous — a near-miss spelling of two answers;
--   unknown   — nobody has judged it (the service asks the AI judge, then retries);
--   empty     — nothing to judge.
-- Only `valid` records anything. `invalid`, `ambiguous` and `unknown` come with up to
-- two `suggestions` (`deep_cut_suggest`); one already said this round is left out.
create or replace function public.deep_cut_party_answer(
  p_party_id uuid,
  p_round    integer,
  p_player   integer,
  p_answer   text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_party    public.deep_cut_parties;
  v_raw      text := nullif(btrim(regexp_replace(coalesce(p_answer, ''), '\s+', ' ', 'g')), '');
  v_key      text;
  v_question smallint;
  v_lookup   record;
  v_answer   public.deep_cut_answers;
begin
  if p_round is null or p_round < 0 or p_round > 59 then
    return jsonb_build_object('outcome', 'invalid_round');
  end if;
  if v_raw is not null and char_length(v_raw) > 60 then
    return jsonb_build_object('outcome', 'invalid_answer');
  end if;
  v_party := public.deep_cut_claim_party(p_party_id);
  if v_party.id is null then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  if p_player is null or p_player < 0 or p_player >= v_party.players then
    return jsonb_build_object('outcome', 'invalid_player');
  end if;
  if p_round >= cardinality(v_party.question_ids) then
    return jsonb_build_object('outcome', 'not_shown');
  end if;
  v_question := v_party.question_ids[p_round + 1];

  v_key := public.deep_cut_key(v_raw);
  if v_raw is null or v_key = '' then
    return jsonb_build_object('outcome', 'judged', 'result', 'empty');
  end if;

  select * into v_lookup from public.deep_cut_lookup(v_question, v_key);
  if v_lookup.answer_id is null then
    return jsonb_build_object('outcome', 'judged', 'result', case v_lookup.kind
      when 'rejected' then 'invalid' when 'ambiguous' then 'ambiguous' else 'unknown' end,
      'suggestions', (select coalesce(jsonb_agg(x.name), '[]'::jsonb)
                        from unnest(public.deep_cut_suggest(v_question, v_raw)) as x(name)
                       where not exists (
                         select 1 from public.deep_cut_party_answers pa
                           join public.deep_cut_answers a on a.id = pa.answer_id
                          where pa.party_id = v_party.id and pa.round = p_round
                            and a.canonical = x.name)));
  end if;

  select * into v_answer from public.deep_cut_answers a where a.id = v_lookup.answer_id;
  insert into public.deep_cut_party_answers (party_id, round, answer_id, question_id, player, raw, tier)
  values (v_party.id, p_round, v_answer.id, v_question, p_player, v_raw, v_answer.tier)
  on conflict (party_id, round, answer_id) do nothing;
  if not found then
    return jsonb_build_object('outcome', 'judged', 'result', 'repeat', 'canonical', v_answer.canonical);
  end if;

  return jsonb_build_object(
    'outcome', 'judged',
    'result', 'valid',
    'canonical', v_answer.canonical,
    'tier', v_answer.tier,
    'points', public.deep_cut_tier_points(v_answer.tier)
  );
end;
$$;

-- What the AI judge needs to rule on a party answer nobody has judged.
create or replace function public.deep_cut_party_context(
  p_judge_key text,
  p_party_id  uuid,
  p_round     integer,
  p_answer    text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_party    public.deep_cut_parties;
  v_question public.deep_cut_questions;
  v_raw      text := nullif(btrim(regexp_replace(coalesce(p_answer, ''), '\s+', ' ', 'g')), '');
  v_key      text;
begin
  if not public.deep_cut_judge_allowed(p_judge_key) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_key := public.deep_cut_key(v_raw);
  select * into v_party from public.deep_cut_parties p where p.id = p_party_id;
  if not found or now() >= v_party.expires_at or v_raw is null or v_key = ''
     or char_length(v_raw) > 60 or p_round is null or p_round < 0
     or p_round >= cardinality(v_party.question_ids) then
    return jsonb_build_object('outcome', 'not_open');
  end if;
  select * into v_question from public.deep_cut_questions q where q.id = v_party.question_ids[p_round + 1];
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

revoke all on function public.deep_cut_party_start(integer) from public;
revoke all on function public.deep_cut_party_question(uuid, integer) from public;
revoke all on function public.deep_cut_party_answer(uuid, integer, integer, text) from public;
revoke all on function public.deep_cut_party_context(text, uuid, integer, text) from public;
grant execute on function public.deep_cut_party_start(integer) to anon, authenticated;
grant execute on function public.deep_cut_party_question(uuid, integer) to anon, authenticated;
grant execute on function public.deep_cut_party_answer(uuid, integer, integer, text) to anon, authenticated;
grant execute on function public.deep_cut_party_context(text, uuid, integer, text) to anon, authenticated;

comment on function public.deep_cut_party_start(integer) is
  'Starts a pass-and-play Deep Cut Party (hot potato) for 2 to 8 players. Unranked; lasts three hours.';
comment on function public.deep_cut_party_question(uuid, integer) is
  'Deals a Deep Cut Party round''s question (never one live in a daily set), with the answers already given that round.';
comment on function public.deep_cut_party_answer(uuid, integer, integer, text) is
  'Judges one Deep Cut Party answer: valid (recorded, scores its tier), repeat, invalid, ambiguous, unknown or empty.';
comment on function public.deep_cut_party_context(text, uuid, integer, text) is
  'The AI judge''s view of an unjudged Deep Cut Party answer. Needs a judge key whose SHA-256 is in deep_cut_judge_keys.';
