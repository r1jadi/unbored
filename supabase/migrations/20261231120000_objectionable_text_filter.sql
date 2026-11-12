-- Objectionable text filter: what players write is checked before it is stored.
--
-- Apple's App Review Guideline 1.2 asks an app with user-generated content for "a
-- method for filtering objectionable material from being posted", alongside
-- reporting and blocking (which Unbored already has). Google Play's user-generated
-- content policy asks the same. The filter lives in the database, so it holds for
-- every path that writes: the web app, the Go services and anything later.
--
--   * `public.moderation_terms`: the words and phrases refused, in English and
--     Albanian. Only staff should read it; nothing public selects from it.
--   * `public.text_is_objectionable(text)`: normalises a text (lower case, accents
--     off, leetspeak decoded) and looks for a term as a whole word, as a word
--     prefix for the terms marked safe for that, with repeated letters squeezed
--     ("fuuuck"), and spelled out letter by letter ("n i g g e r", "f.u.c.k") for
--     the terms marked compact.
--   * Triggers refuse a comment, a chat message or a profile edit that contains a
--     term, raising SQLSTATE `UB001` with the message `objectionable_content`,
--     which the web app (`src/lib/supabase/rest.ts`) and the users service turn
--     into one friendly sentence.
--   * Sign-up is never broken by it: a new profile whose requested username or
--     display name is refused gets a generated username (also standing in as its
--     display name) and is left un-onboarded, so the sign-up flow asks again.
--
-- A filter is a floor, not moderation: reports, blocks and the moderators' queue
-- stay the answer to everything a word list cannot see.

-- ─────────────────────────────────────────────────────────────────────────────
-- The terms
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.moderation_terms (
  term     text primary key check (term = lower(term) and term ~ '^[a-z]+( [a-z]+)*$'),
  -- Also refused as the start of a longer word ("fuck" → "fucking").
  prefix   boolean not null default false,
  -- Also refused spelled out letter by letter ("n i g g e r", "f.u.c.k").
  compact  boolean not null default true,
  added_at timestamptz not null default now()
);

alter table public.moderation_terms enable row level security;
-- No policies: no client role reads or writes the list. Staff edit it in SQL.
revoke all on public.moderation_terms from anon, authenticated;

comment on table public.moderation_terms is
  'Words and phrases refused in comments, chat messages and profiles (App Review 1.2). Read only by public.text_is_objectionable.';

insert into public.moderation_terms (term, prefix, compact) values
  -- English: sexual and abusive profanity.
  ('fuck', true, true), ('motherfucker', true, true), ('fck', false, true),
  ('shit', true, true), ('bullshit', true, true),
  ('cunt', true, true), ('bitch', true, true), ('whore', true, true),
  ('slut', true, true), ('asshole', true, true), ('dickhead', true, true),
  ('cock', false, true), ('cocksucker', true, true), ('pussy', false, true),
  ('bastard', true, true), ('wanker', true, true),
  ('porn', true, true), ('blowjob', true, true),
  ('rape', false, true), ('rapist', true, true), ('raping', false, true),
  ('pedo', false, true), ('paedo', false, true), ('pedophile', true, true),
  -- English: slurs.
  ('nigger', true, true), ('nigga', true, true), ('faggot', true, true), ('fag', false, true),
  ('retard', true, true), ('tranny', true, true), ('spic', false, true),
  ('kike', false, true), ('wetback', true, true),
  -- English: self-harm and hate.
  ('kys', false, true), ('kill yourself', false, true), ('kill urself', false, true),
  ('heil hitler', false, true),
  -- Albanian: sexual and abusive profanity. Whole words only where a prefix would
  -- catch ordinary words ("rrot" and "rrotullo", to rotate).
  ('pidh', true, true), ('pidhi', false, true), ('kar', false, true),
  ('qij', false, true), ('qifsha', true, true), ('qifsh', true, true), ('qir', false, true),
  ('kurv', true, true), ('kurva', false, true), ('kurve', false, true),
  ('lavire', true, true), ('rrot', false, true), ('bythqir', true, true),
  ('pederast', true, true), ('mutin', false, true), ('ta qifsha', false, true)
on conflict (term) do update set prefix = excluded.prefix, compact = excluded.compact;

-- ─────────────────────────────────────────────────────────────────────────────
-- The check
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.text_is_objectionable(p_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lower   text;
  v_words   text;
  v_squeeze text;
  v_joined  text := '';
  v_token   text;
  v_run     boolean := false;
begin
  if p_text is null or btrim(p_text) = '' then
    return false;
  end if;

  -- Accents off and leetspeak decoded: 0→o 1→i 3→e 4→a 5→s 7→t 8→b @→a $→s !→i |→i.
  v_lower := translate(lower(p_text),
    'àáâäãåāçćčèéêëēěìíîïīñňòóôöõøōùúûüūýÿšžđ0134578@$!|',
    'aaaaaaaccceeeeeeiiiiinnooooooouuuuuyyszdoieastbasii');
  -- Words separated by single spaces, padded so a term can be matched whole.
  v_words := ' ' || btrim(regexp_replace(v_lower, '[^a-z]+', ' ', 'g')) || ' ';
  -- The same with runs of one letter squeezed to one: "fuuuuck" → "fuck".
  v_squeeze := regexp_replace(v_words, '([a-z])\1+', '\1', 'g');
  -- Spelled out letter by letter ("f.u.c.k", "n i g g e r"): runs of one-letter
  -- words are joined, and nothing else is, so "snigger" stays "snigger".
  foreach v_token in array regexp_split_to_array(btrim(v_words), ' ') loop
    if char_length(v_token) = 1 and v_run then
      v_joined := v_joined || v_token;
    else
      v_joined := v_joined || ' ' || v_token;
    end if;
    v_run := char_length(v_token) = 1;
  end loop;
  v_joined := v_joined || ' ';

  return exists (
    select 1
      from public.moderation_terms m
     where position(' ' || m.term || ' ' in v_words) > 0
        or (m.prefix and position(' ' || m.term in v_words) > 0)
        -- Squeezed repeats, only for terms that squeezing leaves alone: "nigger"
        -- would squeeze to "niger", which is a country.
        or (char_length(m.term) >= 4
            and m.term !~ '([a-z])\1'
            and position(' ' || m.term || ' ' in v_squeeze) > 0)
        or (m.compact and position(' ' || m.term || ' ' in v_joined) > 0)
        or (m.compact and m.prefix and position(' ' || m.term in v_joined) > 0)
  );
end;
$$;

comment on function public.text_is_objectionable(text) is
  'Whether a text contains a term from public.moderation_terms: whole words, safe prefixes, squeezed repeats and, for unambiguous slurs, spaced-out spellings. Accents and leetspeak are normalised first.';

revoke all on function public.text_is_objectionable(text) from public;
-- The sign-up form asks before a username is submitted.
grant execute on function public.text_is_objectionable(text) to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Refusing it
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.refuse_objectionable_text()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- TG_ARGV names the text columns this table's trigger checks.
  for i in 0 .. tg_nargs - 1 loop
    if public.text_is_objectionable(to_jsonb(new) ->> tg_argv[i]) then
      raise exception 'objectionable_content'
        using errcode = 'UB001',
              detail = tg_argv[i],
              hint = 'Remove the words the community rules do not allow and try again.';
    end if;
  end loop;
  return new;
end;
$$;

comment on function public.refuse_objectionable_text() is
  'Trigger: refuses a row whose named text columns contain an objectionable term (SQLSTATE UB001, message objectionable_content, detail the column).';

drop trigger if exists comments_refuse_objectionable on public.comments;
create trigger comments_refuse_objectionable
  before insert or update of body on public.comments
  for each row execute function public.refuse_objectionable_text('body');

drop trigger if exists messages_refuse_objectionable on public.messages;
create trigger messages_refuse_objectionable
  before insert or update of body on public.messages
  for each row execute function public.refuse_objectionable_text('body');

-- A profile edit is refused like a comment. A new profile is cleaned instead,
-- because a refusal there would abort the auth sign-up itself.
drop trigger if exists profiles_refuse_objectionable on public.profiles;
create trigger profiles_refuse_objectionable
  before update of username, display_name, bio on public.profiles
  for each row execute function public.refuse_objectionable_text('username', 'display_name', 'bio');

create or replace function public.clean_objectionable_new_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.text_is_objectionable(new.username) then
    new.username := 'player_' || substr(replace(new.id::text, '-', ''), 1, 10);
    new.onboarded_at := null;
  end if;
  if public.text_is_objectionable(new.display_name) then
    -- The column is not null: the (clean) username stands in until sign-up asks.
    new.display_name := new.username;
    new.onboarded_at := null;
  end if;
  if public.text_is_objectionable(new.bio) then
    new.bio := null;
  end if;
  return new;
end;
$$;

comment on function public.clean_objectionable_new_profile() is
  'Trigger: a new profile whose requested username or display name is objectionable gets a generated username, that username as its display name and no onboarded_at, so sign-up asks again instead of failing.';

drop trigger if exists profiles_clean_objectionable on public.profiles;
create trigger profiles_clean_objectionable
  before insert on public.profiles
  for each row execute function public.clean_objectionable_new_profile();
