-- The objectionable-text filter (App Review 1.2): what it refuses, what it leaves
-- alone, and where it holds — comments, chat messages, profile edits and sign-up.
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

-- ── The check ───────────────────────────────────────────────────────────────

do $$
declare
  v record;
begin
  for v in select * from (values
    -- Refused: whole words, prefixes, leetspeak, squeezed and spelled-out spellings.
    ('fuck this level', true), ('fucking hard', true), ('fuuuuck', true), ('F U C K', true),
    ('f.u.c.k off', true), ('you are a b1tch', true), ('n i g g e r', true), ('k y s', true),
    ('kill yourself', true), ('this game is SH1T', true), ('fag end', true),
    -- Albanian.
    ('ta qifsha nanen', true), ('pidhi', true), ('je kurve', true), ('LAVIRE', true), ('rrot', true),
    -- Left alone: names, places and words that merely contain a term.
    ('Kari', false), ('Karin played', false), ('Peder', false), ('Dick Grayson', false),
    ('Niger and Nigeria', false), ('Scunthorpe United', false), ('who reads this', false),
    ('Snigger', false), ('my pedometer', false), ('assassin creed', false), ('class pass', false),
    ('cockpit view', false), ('this is shiitake', false), ('spice girls', false),
    ('therapist', false), ('grape juice', false), ('drapes', false),
    ('rrotullo pjesën', false), ('Hello, mirëdita!', false), ('karrota', false), ('qiraja', false),
    ('', false)
  ) as t(txt, want) loop
    if public.text_is_objectionable(v.txt) is distinct from v.want then
      raise exception 'ASSERTION FAILED: text_is_objectionable(%) = %, want %',
        quote_literal(v.txt), not v.want, v.want;
    end if;
  end loop;
  raise notice 'ok   the word filter refuses abuse and leaves ordinary words alone';
end $$;

-- ── Where it holds ──────────────────────────────────────────────────────────

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-0000-4000-8000-0000000000a1', 'clean-filter@example.com', '{"username":"nice_player","display_name":"Nice"}'),
  ('11111111-0000-4000-8000-0000000000a2', 'rude-filter@example.com', '{"username":"fuck_you","display_name":"pidhi"}');

do $$
declare
  v_profile public.profiles;
  v_game uuid := (select id from public.games limit 1);
begin
  -- Sign-up is never refused: a rude name is replaced and sign-up asks again.
  select * into v_profile from public.profiles where id = '11111111-0000-4000-8000-0000000000a2';
  if v_profile.username !~ '^player_' or v_profile.display_name <> v_profile.username
     or v_profile.onboarded_at is not null then
    raise exception 'ASSERTION FAILED: a rude sign-up kept % / % (onboarded %)',
      v_profile.username, v_profile.display_name, v_profile.onboarded_at;
  end if;
  select * into v_profile from public.profiles where id = '11111111-0000-4000-8000-0000000000a1';
  if v_profile.username <> 'nice_player' or v_profile.onboarded_at is null then
    raise exception 'ASSERTION FAILED: a clean sign-up was changed';
  end if;
  raise notice 'ok   sign-up replaces a rude username and display name instead of failing';

  -- Profile edits.
  update public.profiles set bio = 'I like puzzles' where id = '11111111-0000-4000-8000-0000000000a1';
  begin
    update public.profiles set bio = 'k y s' where id = '11111111-0000-4000-8000-0000000000a1';
    raise exception 'ASSERTION FAILED: a rude bio was stored';
  exception when sqlstate 'UB001' then null;
  end;
  begin
    update public.profiles set display_name = 'b1tch' where id = '11111111-0000-4000-8000-0000000000a1';
    raise exception 'ASSERTION FAILED: a rude display name was stored';
  exception when sqlstate 'UB001' then null;
  end;
  raise notice 'ok   a rude bio or display name is refused with UB001';

  -- Comments.
  if v_game is not null then
    insert into public.comments (game_id, author_id, body)
    values (v_game, '11111111-0000-4000-8000-0000000000a1', 'Great game, love it');
    begin
      insert into public.comments (game_id, author_id, body)
      values (v_game, '11111111-0000-4000-8000-0000000000a1', 'this game is SH1T');
      raise exception 'ASSERTION FAILED: a rude comment was stored';
    exception when sqlstate 'UB001' then null;
    end;
    raise notice 'ok   a rude comment is refused with UB001';
  end if;

  -- Chat messages: the trigger is on the table, whatever writes to it.
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.messages'::regclass and tgname = 'messages_refuse_objectionable'
  ) then
    raise exception 'ASSERTION FAILED: chat messages are not filtered';
  end if;
  raise notice 'ok   chat messages carry the filter';
end $$;

rollback;

\echo 'Content filter suite passed.'
