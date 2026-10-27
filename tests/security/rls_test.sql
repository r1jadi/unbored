-- RLS and authorization test suite.
--
-- Run against a throwaway database only:
--   ./scripts/test-rls.sh        (starts an ephemeral Postgres via Docker)
-- The whole file runs in one transaction and rolls back, so it leaves no data.
--
-- Every assertion is written as either
--   allow(...)   — the statement must succeed
--   denied(...)  — the statement must be rejected (privilege or RLS violation)
--   blocked(...) — the statement must silently affect zero rows (RLS filtered)
--   visible(...) — the statement must return the expected row count
--
-- Supabase's hosted project also has `supabase_admin`; its absence is what
-- makes this file safe: it refuses to run where that role exists.

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    raise exception 'refusing to run: this suite is for a throwaway database, not a hosted project';
  end if;
end $$;

\set ON_ERROR_STOP on

create schema if not exists rls_test;
grant usage on schema rls_test to anon, authenticated, service_role;

create or replace function rls_test.ok(condition boolean, message text)
returns void language plpgsql as $$
begin
  if condition is not true then
    raise exception 'ASSERTION FAILED: %', message;
  end if;
  raise notice 'ok   %', message;
end $$;

-- The statement must be rejected.
create or replace function rls_test.denied(statement text, message text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception
    when insufficient_privilege then
      raise notice 'ok   % (denied)', message;
      return;
    when others then
      raise exception 'ASSERTION FAILED: % — unexpected error: % (%)', message, sqlerrm, sqlstate;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', message;
end $$;

-- The statement must be rejected by a constraint (integrity rule) rather than
-- by a policy. Used for the invariants the user can reach.
create or replace function rls_test.rejected(statement text, message text)
returns void language plpgsql as $$
begin
  begin
    execute statement;
  exception
    when check_violation or unique_violation or foreign_key_violation or not_null_violation then
      raise notice 'ok   % (constraint)', message;
      return;
    when insufficient_privilege then
      raise exception 'ASSERTION FAILED: % — blocked by a policy, expected a constraint', message;
    when others then
      raise exception 'ASSERTION FAILED: % — unexpected error: % (%)', message, sqlerrm, sqlstate;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', message;
end $$;

-- The statement must be rejected with a specific SQLSTATE. Used for the
-- server-side write functions, whose invalid input is an exception rather than a
-- policy violation, and whose refusals are outcomes the caller reads.
create or replace function rls_test.raises(statement text, expected_state text, message text)
returns void language plpgsql as $$
declare
  actual text;
begin
  begin
    execute statement;
  exception
    when others then
      actual := sqlstate;
      if actual = expected_state then
        raise notice 'ok   % (raised %)', message, actual;
        return;
      end if;
      raise exception 'ASSERTION FAILED: % — raised %, expected %', message, actual, expected_state;
  end;
  raise exception 'ASSERTION FAILED: % — the statement was allowed', message;
end $$;

-- A server-side function that answers with an outcome rather than raising: the
-- call is made exactly once, because every call has side effects.
create or replace function rls_test.says(statement text, expected text, message text)
returns void language plpgsql as $$
declare
  actual text;
begin
  execute format('select (%s).outcome', statement) into actual;
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % — outcome was %, expected %', message, coalesce(actual, 'null'), expected;
  end if;
  raise notice 'ok   % (outcome %)', message, actual;
end $$;

-- One field of that same answer, read from a single call.
create or replace function rls_test.says_field(statement text, field text, expected text, message text)
returns void language plpgsql as $$
declare
  actual text;
begin
  execute format('select (%s).%s::text', statement, field) into actual;
  if actual is distinct from expected then
    raise exception 'ASSERTION FAILED: % — % was %, expected %', message, field, coalesce(actual, 'null'), expected;
  end if;
  raise notice 'ok   % (% = %)', message, field, actual;
end $$;

-- The statement must succeed while touching no rows.
create or replace function rls_test.blocked(statement text, message text)
returns void language plpgsql as $$
declare
  affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'ASSERTION FAILED: % — % rows were affected, expected 0', message, affected;
  end if;
  raise notice 'ok   % (0 rows)', message;
end $$;

-- The statement must succeed and affect at least one row.
create or replace function rls_test.allow(statement text, message text)
returns void language plpgsql as $$
declare
  affected bigint;
begin
  execute statement;
  get diagnostics affected = row_count;
  if affected = 0 then
    raise exception 'ASSERTION FAILED: % — the statement affected no rows', message;
  end if;
  raise notice 'ok   % (allowed)', message;
end $$;

-- The statement must succeed and return exactly one non-null uuid, which the
-- caller compares against the expected value.
create or replace function rls_test.allow_uuid(statement text, message text)
returns uuid language plpgsql as $$
declare
  value uuid;
begin
  execute statement into value;
  if value is null then
    raise exception 'ASSERTION FAILED: % — the statement returned NULL', message;
  end if;
  raise notice 'ok   % (allowed)', message;
  return value;
end $$;

create or replace function rls_test.count_rows(statement text)
returns bigint language plpgsql as $$
declare
  total bigint;
begin
  execute 'select count(*) from (' || statement || ') as t' into total;
  return total;
end $$;

create or replace function rls_test.visible(statement text, expected bigint, message text)
returns void language plpgsql as $$
declare
  actual bigint;
begin
  actual := rls_test.count_rows(statement);
  if actual <> expected then
    raise exception 'ASSERTION FAILED: % — saw % rows, expected %', message, actual, expected;
  end if;
  raise notice 'ok   % (% rows)', message, actual;
end $$;

grant execute on all functions in schema rls_test to anon, authenticated, service_role;

begin;

-- ─────────────────────────────────────────────────────────────────────────────
-- Fixtures (created as the superuser, then rolled back at the end)
-- ─────────────────────────────────────────────────────────────────────────────

\set alice '11111111-1111-4111-8111-111111111111'
\set bob   '22222222-2222-4222-8222-222222222222'
\set carol '33333333-3333-4333-8333-333333333333'
\set dave  '44444444-4444-4444-8444-444444444444'
\set erin  '55555555-5555-4555-8555-555555555555'

insert into auth.users (id, email) values
  (:'alice', 'alice@example.com'),
  (:'bob',   'bob@example.com'),
  (:'carol', 'carol@example.com'),
  (:'dave',  'dave@example.com'),
  (:'erin',  'erin@example.com');

-- The auth trigger must have created a profile and a role row for each user.
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.profiles where id = '11111111-1111-4111-8111-111111111111'$$) = 1,
  'new auth users get a profile automatically'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.user_roles where user_id = '11111111-1111-4111-8111-111111111111' and role = 'user'$$) = 1,
  'new auth users get the least-privileged role'
);

-- A username chosen at sign-up travels in the auth user's metadata. The trigger
-- normalizes it once (trim + lowercase) and writes it with the profile in the
-- account's own transaction, so it is the account's name from the start rather
-- than something a later step replaces.
insert into auth.users (id, email, raw_user_meta_data) values
  ('77777777-7777-4777-8777-777777777777', 'frank@example.com', '{"username":"  Chosen_One  "}'::jsonb);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.profiles where id = '77777777-7777-4777-8777-777777777777' and username = 'chosen_one'$$) = 1,
  'a chosen username is normalized and written by the trigger'
);

-- The unique index is the final authority: a second account cannot claim the
-- same name, and the failed auth insert leaves no half-created account behind.
select rls_test.rejected(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-4888-8888-888888888888', 'grace@example.com', '{"username":"chosen_one"}'::jsonb)$$,
  'a second account cannot claim the same username'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from auth.users where id = '88888888-8888-4888-8888-888888888888'$$) = 0,
  'a rejected registration leaves no auth user behind'
);
select rls_test.rejected(
  $$insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-4999-8999-999999999999', 'heidi@example.com', '{"username":"CHOSEN_ONE"}'::jsonb)$$,
  'username uniqueness is case-insensitive'
);

-- Metadata that is not a valid username is never stored. OAuth providers keep
-- working (their metadata has no such key), and an unusable value falls back to
-- the generated form rather than persisting something the format rule rejects.
insert into auth.users (id, email, raw_user_meta_data) values
  ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', 'ivan@example.com', '{"username":"not valid!"}'::jsonb);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.profiles where id = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa' and username ~ '^user_[0-9a-f]{12}$'$$) = 1,
  'invalid signup metadata falls back to a generated username'
);

-- These probe accounts were only for the trigger assertions above; removing them
-- keeps the rest of the suite's profile counts describing the five fixtures.
delete from auth.users
 where id in ('77777777-7777-4777-8777-777777777777', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa');

-- Roles are granted out of band (service_role today, a dashboard action later).
update public.user_roles set role = 'moderator' where user_id = :'carol';
update public.user_roles set role = 'admin' where user_id = :'dave';
update public.profiles set is_suspended = true where id = :'erin';

-- The seed already created the reference categories; keep the fixture
-- idempotent so this file works with and without seed.sql applied.
insert into public.categories (slug, name) values ('puzzle', 'Puzzle')
on conflict (slug) do nothing;
insert into public.categories (slug, name) values ('arcade', 'Arcade')
on conflict (slug) do nothing;

\set published_game 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
\set draft_game     'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'
\set bob_game       'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'

-- The slugs are prefixed `fixture-` on purpose. The catalogue migration ships
-- the real first-party games (including `stack-10`), and the unique index on
-- `slug` would reject a fixture that reused one of them.
--
-- The categories are load-bearing for the count assertions further down:
-- `puzzle` holds a published fixture and `word` holds only a draft, so a real
-- published-game count must be non-zero for one and exactly zero for the other.
insert into public.games (id, owner_id, slug, title, status, published_at, category_id) values
  (:'published_game', :'alice', 'fixture-stack', 'Fixture Stack', 'published', now(),
   (select id from public.categories where slug = 'puzzle')),
  (:'draft_game',     :'alice', 'fixture-draft', 'Fixture Draft', 'draft', null,
   (select id from public.categories where slug = 'word')),
  (:'bob_game',       :'bob',   'fixture-bob',   'Fixture Bob',   'published', now(),
   (select id from public.categories where slug = 'arcade'));

-- Integrity rules added with the catalogue. These are asserted here, outside any
-- role switch, because they must hold for every writer including the database
-- owner — a policy can only constrain the roles it names.
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, playable) values ('11111111-1111-4111-8111-111111111111', 'fixture-playable', 'Claimed Playable', true)$$,
  'a game cannot be playable without a runtime'
);
select rls_test.rejected(
  $$insert into public.games (slug, title, status) values ('fixture-orphan', 'Orphan', 'published')$$,
  'a game is either owned by an account or explicitly first-party'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, runtime) values ('11111111-1111-4111-8111-111111111111', 'fixture-runtime', 'Runtime', 'Not A Runtime')$$,
  'a runtime identifier must look like a slug'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, cover_path) values ('11111111-1111-4111-8111-111111111111', 'fixture-cover', 'Cover', 'no-folder-here')$$,
  'a cover path must live under a folder'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title, instructions) values ('11111111-1111-4111-8111-111111111111', 'fixture-instructions', 'Instructions', '')$$,
  'instructions are either written or absent, never empty'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.games where is_official and owner_id is not null$$) = 0,
  'a first-party game carries no account as its owner'
);

\set alice_comment 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'
\set hidden_comment 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
\set bob_comment   'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'

insert into public.comments (id, game_id, author_id, body, is_hidden) values
  (:'alice_comment', :'published_game', :'alice', 'Nice one', false),
  (:'hidden_comment', :'published_game', :'alice', 'Removed by a moderator', true),
  (:'bob_comment',   :'published_game', :'bob',   'Agreed', false);

insert into public.notifications (user_id, kind, payload) values
  (:'alice', 'system', '{"message":"welcome"}'),
  (:'bob',   'system', '{"message":"welcome"}');

insert into public.reports (reporter_id, target_kind, target_id, reason)
values (:'alice', 'comment', :'bob_comment', 'spam');

insert into public.likes (user_id, target_kind, target_id)
values (:'bob', 'game', :'published_game');

insert into public.saves (user_id, game_id)
values (:'bob', :'published_game');

insert into public.game_sessions (game_id, user_id) values (:'published_game', :'alice');

-- ─────────────────────────────────────────────────────────────────────────────
-- Anonymous callers
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- Absolute row counts are deliberately not asserted for the whole table: the
-- catalogue migration ships the real first-party games, so how many rows exist
-- is content, not a rule. The rule is asserted directly — one global statement
-- that must hold whatever the catalogue holds, plus per-fixture visibility.
select rls_test.visible($$select id from public.games where status <> 'published'$$, 0,
  'no unpublished game is visible to an anonymous caller');
select rls_test.visible($$select id from public.games where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$, 1,
  'anon sees a published game');
select rls_test.visible($$select id from public.games where id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'$$, 1,
  'anon sees another creator''s published game');
select rls_test.visible($$select id from public.games where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$, 0, 'anon cannot see a draft');
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.games where slug = 'stack-10'$$) = 1,
  'the real first-party catalogue is readable by an anonymous caller'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.games where playable and runtime is null$$) = 0,
  'nothing is presented as playable without a runtime'
);
select rls_test.ok(
  rls_test.count_rows($$select id from public.categories$$) >= 2,
  'anon reads reference data'
);

-- Real published-game counts, as the categories endpoint reads them.
select rls_test.ok(
  (select game_count from public.category_game_counts where slug = 'puzzle') >= 1,
  'a category with a published game reports a non-zero count'
);
select rls_test.ok(
  (select game_count from public.category_game_counts where slug = 'word') = 0,
  'a category whose only game is a draft reports zero'
);
select rls_test.ok(
  (select count(*) from public.category_game_counts) = (select count(*) from public.categories),
  'every category is counted, including the empty ones'
);

select rls_test.denied($$insert into public.games (owner_id, slug, title) values ('11111111-1111-4111-8111-111111111111', 'x-game', 'X')$$,
  'anon cannot create games');
select rls_test.denied($$select id from public.analytics_events$$,
  'anon cannot read analytics events');
select rls_test.denied($$select id from public.notifications$$,
  'anon cannot read notifications');
select rls_test.denied($$select user_id from public.user_roles$$,
  'anon cannot read the role table');
select rls_test.visible($$select id from public.comments where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'$$, 0,
  'a hidden comment is invisible to anonymous callers');
select rls_test.visible($$select id from public.profiles$$, 5, 'public profile fields are readable');
select rls_test.denied($$select is_suspended from public.profiles$$,
  'the suspension flag is not readable through the Data API');
select rls_test.denied($$update public.profiles set display_name = 'anon' where id = '11111111-1111-4111-8111-111111111111'$$,
  'anon cannot write profiles');
select rls_test.denied($$select * from public.saves$$,
  'saved games are not readable by anonymous callers at all');

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Signed-in user: Alice
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(auth.uid() = :'alice'::uuid, 'auth.uid() resolves from the verified claims');

-- Visibility. Scoped to the fixture ids for the same reason as above.
select rls_test.visible($$select id from public.games where id in ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')$$, 3, 'a creator sees published games plus own drafts');
select rls_test.visible($$select id from public.game_sessions$$, 1, 'a player sees own sessions');
select rls_test.visible($$select id from public.notifications$$, 1, 'a player sees only own notifications');
select rls_test.visible($$select user_id from public.user_roles$$, 1, 'a player sees only own role row');
select rls_test.visible($$select id from public.comments$$, 3, 'a hidden comment stays visible to its author');
select rls_test.visible($$select id from public.comments where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'$$, 1,
  'the author sees their own hidden comment by id');
select rls_test.visible($$select id from public.profiles$$, 5, 'profiles are readable (public profile fields)');

-- Own profile writes are allowed, privileged columns are not
select rls_test.ok(
  (select count(*) from public.profiles where id = :'alice') = 1,
  'a player can read own profile row'
);
select rls_test.denied(
  $$update public.profiles set is_suspended = false where id = '55555555-5555-4555-8555-555555555555'$$,
  'a player cannot clear another account''s suspension'
);
-- Usernames are writable by their own account only. The format CHECK and the
-- case-insensitive unique index stay the authority behind the API's validation:
-- 'BOB' never reaches the index because the format check rejects uppercase
-- first, so case-insensitivity needs no separate assertion here.
select rls_test.allow(
  $$update public.profiles set username = 'alice_renamed' where id = '11111111-1111-4111-8111-111111111111'$$,
  'a player can rename their own account'
);
select rls_test.ok(
  (select username = 'alice_renamed' from public.profiles where id = :'alice'),
  'the renamed username is what the row holds'
);
select rls_test.rejected(
  $$update public.profiles set username = (select username from public.profiles where id = '22222222-2222-4222-8222-222222222222') where id = '11111111-1111-4111-8111-111111111111'$$,
  'a username someone else holds is rejected, so concurrent renames cannot collide'
);
select rls_test.blocked(
  $$update public.profiles set username = 'alice_writes_bob' where id = '22222222-2222-4222-8222-222222222222'$$,
  'a player cannot rename another account'
);
select rls_test.rejected(
  $$update public.profiles set username = 'No Capitals' where id = '11111111-1111-4111-8111-111111111111'$$,
  'a username outside the format is rejected'
);

-- Escalation attempts
select rls_test.denied(
  $$insert into public.user_roles (user_id, role) values ('11111111-1111-4111-8111-111111111111', 'admin')$$,
  'a player cannot grant themselves a role'
);
select rls_test.denied(
  $$update public.user_roles set role = 'admin' where user_id = '11111111-1111-4111-8111-111111111111'$$,
  'a player cannot promote themselves'
);
select rls_test.denied(
  $$insert into public.scores (session_id, game_id, user_id, score) values (gen_random_uuid(), 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 999999)$$,
  'a player cannot write a score directly'
);
select rls_test.denied(
  $$update public.games set owner_id = '22222222-2222-4222-8222-222222222222' where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$,
  'game ownership is immutable'
);

-- Publishing is a moderation decision
select rls_test.denied(
  $$update public.games set status = 'published' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a creator cannot publish their own game'
);
select rls_test.allow(
  $$update public.games set title = 'Draft Game v2' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a creator can edit an own draft'
);
select rls_test.blocked(
  $$update public.games set title = 'Hijacked' where id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'$$,
  'a creator cannot edit someone else''s game'
);
select rls_test.blocked(
  $$delete from public.games where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$,
  'a published game cannot be deleted by its owner'
);

-- Comments
select rls_test.blocked(
  $$update public.comments set body = 'edited' where id = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'$$,
  'a player cannot edit another author''s comment'
);
select rls_test.denied(
  $$update public.comments set is_hidden = false where id = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'$$,
  'a player cannot unhide a moderated comment'
);
select rls_test.denied(
  $$insert into public.comments (game_id, author_id, body) values ('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111', 'spam on a draft')$$,
  'comments are only accepted on published games'
);
select rls_test.denied(
  $$insert into public.comments (game_id, author_id, body) values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'not mine')$$,
  'a player cannot post as another user'
);

-- Social writes are always attributed to the verified caller
select rls_test.allow(
  $$insert into public.likes (user_id, target_kind, target_id)
    values ('11111111-1111-4111-8111-111111111111', 'game', 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa')$$,
  'a player can like a game as themselves'
);
select rls_test.denied(
  $$insert into public.likes (user_id, target_kind, target_id) values ('22222222-2222-4222-8222-222222222222', 'game', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'a player cannot like as another user'
);
select rls_test.blocked(
  $$delete from public.likes where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'a player cannot remove another player''s like'
);
select rls_test.allow(
  $$delete from public.likes
    where user_id = '11111111-1111-4111-8111-111111111111'
      and target_kind = 'game'
      and target_id = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa'$$,
  'a player can remove their own like'
);

-- Saved games are private rows: only the owner reads, adds or removes them,
-- only for published games, and a second save conflicts instead of duplicating.
select rls_test.allow(
  $$insert into public.saves (user_id, game_id)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'a player can save a published game as themselves'
);
select rls_test.rejected(
  $$insert into public.saves (user_id, game_id)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'saving the same game twice is rejected, so concurrent saves cannot duplicate'
);
select rls_test.denied(
  $$insert into public.saves (user_id, game_id)
    values ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa')$$,
  'a player cannot save as another user'
);
select rls_test.denied(
  $$insert into public.saves (user_id, game_id)
    values ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa')$$,
  'a draft game cannot be saved'
);
select rls_test.blocked(
  $$delete from public.saves where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'a player cannot remove another player''s save'
);
select rls_test.allow(
  $$delete from public.saves
    where user_id = '11111111-1111-4111-8111-111111111111'
      and game_id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'$$,
  'a player can remove their own save'
);
select rls_test.visible($$select * from public.saves$$, 0,
  'a player sees only their own saves');

-- Comments follow the same attribution rule, with author-or-staff deletion.
select rls_test.blocked(
  $$delete from public.comments where id = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'$$,
  'a player cannot delete another author''s comment'
);
select rls_test.rejected(
  $$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')$$,
  'self-following is rejected'
);
select rls_test.rejected(
  $$insert into public.games (owner_id, slug, title) values ('11111111-1111-4111-8111-111111111111', 'Stack 10', 'Bad Slug')$$,
  'invalid game slugs are rejected before they reach the catalogue'
);
select rls_test.allow(
  $$update public.games set instructions = 'Tap a column to drop a tile.' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a creator can write instructions on an own draft'
);

-- First-party content is not something a user can mint, and the badge is not a
-- field any client may flip.
select rls_test.denied(
  $$insert into public.games (owner_id, slug, title, is_official) values ('11111111-1111-4111-8111-111111111111', 'fixture-official', 'Fake Official', true)$$,
  'a creator cannot mint first-party content'
);
select rls_test.denied(
  $$update public.games set is_official = true where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'the first-party flag is not writable through the Data API'
);

-- Sessions
select rls_test.visible(
  $$select id from public.game_sessions where user_id = '22222222-2222-4222-8222-222222222222'$$,
  0,
  'another player''s sessions are invisible'
);
select rls_test.denied(
  $$insert into public.game_sessions (game_id, user_id) values ('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222')$$,
  'a player cannot open a session for someone else'
);

-- Reports
select rls_test.visible($$select id from public.reports$$, 1, 'a reporter sees own reports');
select rls_test.blocked(
  $$update public.reports set status = 'dismissed' where reporter_id = '11111111-1111-4111-8111-111111111111'$$,
  'a reporter cannot resolve their own report'
);
select rls_test.blocked(
  $$update public.notifications set read_at = now() where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'notifications belonging to another user cannot be updated'
);
select rls_test.allow(
  $$update public.notifications set read_at = now() where user_id = '11111111-1111-4111-8111-111111111111'$$,
  'a player can mark their own notifications read'
);

-- Storage
select rls_test.denied(
  $$insert into storage.objects (bucket_id, name, owner) values ('avatars', '22222222-2222-4222-8222-222222222222/steal.png', '11111111-1111-4111-8111-111111111111')$$,
  'a player cannot upload into another user''s folder'
);
select rls_test.allow(
  $$insert into storage.objects (bucket_id, name, owner)
    values ('avatars', '11111111-1111-4111-8111-111111111111/me.png', '11111111-1111-4111-8111-111111111111')$$,
  'a player can upload into their own folder'
);
select rls_test.visible($$select id from storage.objects where bucket_id = 'game-builds'$$, 0,
  'private build objects are invisible to other users');

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Suspended user
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'erin', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.denied(
  $$update public.profiles set display_name = 'still here' where id = '55555555-5555-4555-8555-555555555555'$$,
  'a suspended account cannot update its profile'
);
select rls_test.denied(
  $$update public.profiles set username = 'erin_returns' where id = '55555555-5555-4555-8555-555555555555'$$,
  'a suspended account cannot rename itself either'
);
select rls_test.visible(
  $$select id from public.profiles where id = '55555555-5555-4555-8555-555555555555'$$,
  1,
  'a suspended account can still read its own profile'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Moderator and administrator
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'carol', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(public.is_staff(), 'a moderator is staff');
select rls_test.ok(not public.is_admin(), 'a moderator is not an administrator');
select rls_test.ok(
  (public.admin_identity() ->> 'isStaff') = 'true'
    and (public.admin_identity() ->> 'isAdmin') = 'false',
  'a moderator reads staff status from the database rather than from a claim'
);
select rls_test.visible($$select id from public.reports$$, 1, 'a moderator sees the report queue');
select rls_test.visible($$select id from public.comments$$, 3, 'a moderator sees hidden comments');
select rls_test.allow(
  $$update public.reports set status = 'reviewing'$$,
  'a moderator can triage a report'
);
select rls_test.ok(
  (select resolved_by is null from public.reports limit 1),
  'triaging does not stamp a resolver'
);
select rls_test.ok(
  rls_test.allow_uuid(
    $$update public.reports set status = 'resolved' returning resolved_by$$,
    'a moderator can resolve a report'
  ) = '33333333-3333-4333-8333-333333333333'::uuid,
  'resolving stamps the caller as the resolver, not a client-supplied value'
);
select rls_test.allow(
  $$update public.games set status = 'published' where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'a moderator can publish a game'
);
select rls_test.denied(
  $$update public.games set is_official = true where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'$$,
  'even staff cannot flip the first-party flag through the Data API'
);
select rls_test.ok(
  (select published_at is not null from public.games where id = 'aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa'),
  'publishing stamps published_at in the database'
);
select rls_test.denied(
  $$insert into public.user_roles (user_id, role) values ('22222222-2222-4222-8222-222222222222', 'admin')$$,
  'a moderator cannot grant roles'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'dave', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(public.is_admin(), 'an administrator is an administrator');
select rls_test.ok(public.is_staff(), 'an administrator is also staff');
select rls_test.ok(
  (public.admin_identity() ->> 'isAdmin') = 'true',
  'an administrator reads the administrator role from the database'
);
select rls_test.denied(
  $$update public.profiles set is_suspended = true where id = '22222222-2222-4222-8222-222222222222'$$,
  'suspension is not writable through the Data API, even for an administrator'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Admin operations (the staff-gated definer functions)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- These run as the definer and therefore bypass RLS, so the role check inside
-- each one is the only control. What matters here is the *denied* direction:
-- a signed-in stranger must not be able to read the directory, the queue or the
-- aggregates, and must not be able to moderate anything.
--
-- `denied(...)` is for the refusals the guard raises (a missing privilege and a
-- guard both answer 42501, so a stranger cannot tell a closed table from a
-- forbidden function). `raises(...)` is for the validation refusals, which are
-- the caller's own mistake and carry their own SQLSTATE.

-- Two rows with known ids, so the write assertions below can name them. A
-- report is created by the owner rather than by a service, exactly as a real
-- report would be before staff ever see it, and the draft game exists only so a
-- staff read can be shown returning a row no other role can see.
\set admin_report 'dddddddd-1111-4111-8111-dddddddddddd'
\set admin_draft  'aaaaaaaa-9999-4999-8999-aaaaaaaaaaaa'
insert into public.reports (id, reporter_id, target_kind, target_id, reason)
values (:'admin_report', :'bob', 'comment', :'bob_comment', 'admin suite fixture');
insert into public.games (id, owner_id, slug, title, status)
values (:'admin_draft', :'bob', 'fixture-admin-only', 'Fixture Admin Only', 'draft');

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select rls_test.denied(
  $$select public.admin_identity()$$,
  'an anonymous caller has no identity row to read'
);
select rls_test.denied(
  $$select public.admin_overview()$$,
  'an anonymous caller cannot read the admin overview'
);
select rls_test.denied(
  $$select * from public.admin_user_directory()$$,
  'an anonymous caller cannot read the account directory'
);
select rls_test.denied(
  $$select * from public.admin_report_directory()$$,
  'an anonymous caller cannot read the moderation queue'
);
select rls_test.denied(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'x')$$,
  'an anonymous caller cannot hide a comment'
);

reset role;

-- An ordinary signed-in player is refused by the guard inside each function,
-- which raises the same SQLSTATE a missing grant does.
select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(
  (public.admin_identity() ->> 'role') = 'user'
    and (public.admin_identity() ->> 'isStaff') = 'false'
    and (public.admin_identity() ->> 'userId') = '11111111-1111-4111-8111-111111111111'
    -- The username in the answer is the caller's own profile, not a name from
    -- anywhere else: it is read with `auth.uid()`, never with a parameter.
    and (public.admin_identity() ->> 'username')
        = (select username::text from public.profiles where id = '11111111-1111-4111-8111-111111111111'),
  'a player reads their own role and identity from the database, and is not staff'
);
select rls_test.denied($$select public.admin_overview()$$,
  'a player cannot read the admin overview');
select rls_test.denied($$select public.admin_analytics()$$,
  'a player cannot read platform analytics');
select rls_test.denied($$select * from public.admin_user_directory()$$,
  'a player cannot read the account directory');
select rls_test.denied($$select * from public.admin_game_directory()$$,
  'a player cannot list every game, published or not');
select rls_test.visible(
  $$select id from public.games where slug = 'fixture-admin-only'$$,
  0,
  'an unpublished game another account owns is invisible to a player'
);
select rls_test.denied($$select * from public.admin_report_directory()$$,
  'a player cannot read the moderation queue');
select rls_test.denied($$select * from public.admin_comment_directory()$$,
  'a player cannot read the comment moderation list');
select rls_test.denied($$select * from public.admin_score_directory()$$,
  'a player cannot read every verified score');
select rls_test.denied($$select * from public.admin_moderation_log()$$,
  'a player cannot read the audit trail');
select rls_test.denied(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'x')$$,
  'a player cannot archive a game'
);
select rls_test.denied(
  $$select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', 'x')$$,
  'a player cannot dismiss a report'
);
select rls_test.denied(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'x')$$,
  'a player cannot hide a comment'
);
select rls_test.denied(
  $$select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, 'x')$$,
  'a player cannot suspend another account'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Staff functions without a role row
-- ─────────────────────────────────────────────────────────────────────────────
--
-- The signup trigger gives every account a `user` row, so an account with no
-- row at all is one the operator never assigned — the allowlisted-but-
-- unassigned case the application layer authorizes from ADMIN_EMAILS. The row
-- guards must still refuse it here: staff comes from a row, never from the
-- absence of one, and the API layer above is what grants allowlisted callers.
-- The fixture account is removed again at the end of the section, so no later
-- count can see it.
insert into auth.users (id, email)
values ('66666666-6666-4666-8666-666666666666', 'rowless@example.com');
delete from public.user_roles where user_id = '66666666-6666-4666-8666-666666666666';

select set_config('request.jwt.claims',
  json_build_object('sub', '66666666-6666-4666-8666-666666666666', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(
  (public.admin_identity() ->> 'isStaff') = 'false'
    and (public.admin_identity() ->> 'role') = 'user',
  'without a role row the database reports a plain user, which is what the API echoes before its own check'
);
select rls_test.denied($$select public.admin_overview()$$,
  'without a role row the overview guard refuses');
select rls_test.denied($$select * from public.admin_user_directory()$$,
  'without a role row the account directory guard refuses');
select rls_test.denied(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'x')$$,
  'without a role row a moderation write is refused');

reset role;
delete from auth.users where id = '66666666-6666-4666-8666-666666666666';

select set_config('request.jwt.claims',
  json_build_object('sub', :'carol', 'role', 'authenticated')::text, true);
set local role authenticated;

-- A moderator may read the directory, and through it the restricted columns the
-- Data API deliberately withholds.
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_user_directory()
    where id = '55555555-5555-4555-8555-555555555555'
      and is_suspended and email = 'erin@example.com'$$) = 1,
  'a moderator can see a suspended account''s email and suspension state through the directory'
);
select rls_test.denied(
  $$select is_suspended from public.profiles limit 1$$,
  'the same column is still unreachable directly through the Data API'
);
select rls_test.ok(
  (public.admin_overview() ->> 'totalUsers')::bigint >= 5,
  'the overview counts the real profile rows and requires staff'
);
select rls_test.ok(
  (public.admin_overview() ->> 'series') is not null
    and jsonb_array_length(public.admin_overview() -> 'series') = 14,
  'the overview series is fourteen real days, not a fabricated projection'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_game_directory()
    where slug = 'fixture-admin-only' and status = 'draft'$$) = 1,
  'the game directory includes a draft that no other role can see'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_game_directory()
    where slug = 'fixture-stack' and plays = 0 and players = 0$$) = 1,
  'the game directory counts completed runs only: an unfinished session is not a play'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_report_directory()
    where reporter_username is not null$$) >= 1,
  'the report queue resolves its reporter through a join the Data API cannot do'
);
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_comment_directory()
    where is_hidden$$) >= 1,
  'the comment list carries hidden comments, which staff alone may see'
);

-- Moderation writes: the decision and its audit land together, and the audit
-- names the caller from the token. Each call happens once (`says_field` reads one
-- field of one call) because every one of them has a side effect.
select rls_test.ok(
  (select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'Retired fixture')
     ->> 'status') = 'archived',
  'a moderator can archive a published game'
);
select rls_test.ok(
  (select status = 'archived' and published_at is null from public.games
     where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  'archiving clears the publication timestamp in the database'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'archive_game' and moderator_id = '33333333-3333-4333-8333-333333333333'$$) = 1,
  'the archive is recorded against the moderator who made the decision'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'draft', 'Back to draft')$$,
  '22023',
  'staff cannot move a game back to draft — that is the creator''s own state'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'Again')$$,
  '22023',
  'a game already in that status is refused rather than silently rewritten'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-2222-4222-8222-aaaaaaaaaaaa', 'rejected', null)$$,
  '22023',
  'rejecting a game without a reason is refused'
);
select rls_test.raises(
  $$select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-999999999999', 'published', null)$$,
  'P0002',
  'moderating a game that does not exist is refused, not ignored'
);
select rls_test.ok(
  (select public.admin_set_game_status('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'published', null)
     ->> 'status') = 'published',
  'republishing an archived game restores it'
);
select rls_test.ok(
  (select status = 'published' and published_at is not null from public.games
     where id = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'),
  'republishing re-stamps published_at from the database clock'
);

select rls_test.raises(
  $$select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, null)$$,
  '22023',
  'hiding a comment without a reason is refused'
);
select rls_test.ok(
  (select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'Abuse')
     ->> 'hidden') = 'true',
  'a moderator can hide a comment through the function, not the Data API'
);
select rls_test.ok(
  (select is_hidden from public.comments where id = 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'),
  'the hidden comment is hidden in the table, not only in the answer'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'hide_comment' and moderator_id = '33333333-3333-4333-8333-333333333333'$$) = 1,
  'hiding a comment records who hid it'
);
select rls_test.ok(
  (select public.admin_set_comment_hidden('bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', false, null)
     ->> 'hidden') = 'false',
  'and restore it without a reason'
);
select rls_test.raises(
  $$select public.admin_set_comment_hidden('99999999-9999-4999-8999-999999999999', true, 'Nope')$$,
  'P0002',
  'hiding a comment that does not exist is refused'
);

-- Reopening a report has to clear the resolution, or the table's own constraint
-- would refuse the change.
select rls_test.raises(
  $$select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', null)$$,
  '22023',
  'dismissing a report without a reason is refused'
);
select rls_test.ok(
  (select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', 'Not a real report')
     ->> 'status') = 'dismissed',
  'a moderator can dismiss a report'
);
select rls_test.ok(
  (select resolved_by = '33333333-3333-4333-8333-333333333333'::uuid and resolved_at is not null
     from public.reports where id = 'dddddddd-1111-4111-8111-dddddddddddd'),
  'the resolver is stamped from the token, not from the request'
);
select rls_test.ok(
  (select public.admin_set_report_status('dddddddd-1111-4111-8111-dddddddddddd', 'reviewing', 'Reopened')
     ->> 'status') = 'reviewing',
  'a moderator can reopen a report'
);
select rls_test.ok(
  (select resolved_by is null and resolved_at is null from public.reports
     where id = 'dddddddd-1111-4111-8111-dddddddddddd'),
  'reopening clears the recorded resolution'
);
select rls_test.denied(
  $$select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, 'Abuse')$$,
  'a moderator cannot suspend an account — that is an administrator decision'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'dave', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.raises(
  $$select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, null)$$,
  '22023',
  'suspending an account without a reason is refused'
);
select rls_test.ok(
  (select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', true, 'Abusive comments')
     ->> 'suspended') = 'true',
  'an administrator can suspend an account through the function'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.admin_user_directory()
    where id = '22222222-2222-4222-8222-222222222222' and is_suspended$$) = 1,
  'the suspension is written to the column the Data API cannot read or update'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'suspend_account' and moderator_id = '44444444-4444-4444-8444-444444444444'$$) = 1,
  'the suspension is recorded against the administrator who made it'
);
select rls_test.raises(
  $$select public.admin_set_suspension('44444444-4444-4444-8444-444444444444', true, 'Locking myself out')$$,
  '22023',
  'an administrator cannot suspend their own account'
);
select rls_test.raises(
  $$select public.admin_set_suspension('99999999-9999-4999-8999-999999999999', true, 'No such account')$$,
  'P0002',
  'suspending an account that does not exist is refused'
);
select rls_test.ok(
  (select public.admin_set_suspension('22222222-2222-4222-8222-222222222222', false, null)
     ->> 'suspended') = 'false',
  'an administrator can restore an account'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.admin_user_directory()
    where id = '22222222-2222-4222-8222-222222222222' and not is_suspended$$) = 1,
  'the restored account reads as restored through the same directory'
);
select rls_test.visible(
  $$select * from public.admin_moderation_log() where action = 'suspend_account'$$,
  1,
  'the audit trail lists the decision that was just made'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Service role (server-side only: the key never reaches a browser)
-- ─────────────────────────────────────────────────────────────────────────────

set local role service_role;

select rls_test.allow(
  $$insert into public.scores (session_id, game_id, user_id, score)
    select id, game_id, user_id, 4200 from public.game_sessions limit 1$$,
  'the service role can write scores'
);
select rls_test.allow(
  $$update public.user_roles set role = 'moderator' where user_id = '22222222-2222-4222-8222-222222222222'$$,
  'the service role can grant roles'
);
select rls_test.allow(
  $$update public.comments set is_hidden = true where id = 'bbbbbbbb-3333-4333-8333-bbbbbbbbbbbb'$$,
  'the service role can hide a comment'
);

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Privileged admin-data bridge (service_role-only *_svc wrappers)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- An allowlisted administrator without a `user_roles` row is served through
-- these wrappers: the Go service verifies ADMIN_EMAILS, then calls with the
-- service credential and the verified actor. This section asserts both
-- directions: ordinary tokens fail at the grant before any body runs, and the
-- service role is served real data with the verified actor attributed. The
-- row-gated functions keep their behaviour for everyone else — the suite
-- above already proves that, and the current_role assertion below pins the
-- bridge flag absent for ordinary callers.

\set bridge_actor '99999999-9999-4999-8999-999999999999'
\set bridge_comment 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee'

-- Fresh fixtures, created as the owner like the other suites' fixtures. The
-- actor deliberately holds no role row at all: the bridge must not need one.
insert into public.comments (id, game_id, author_id, body)
values (:'bridge_comment', :'published_game', :'bob', 'Bridge fixture comment');

-- The grants, stated plainly: no privileged wrapper is executable by anon or
-- authenticated, and every read wrapper is executable by service_role. (The
-- enum-typed write wrappers are asserted behaviourally below instead of by
-- signature string. `admin_actor()` is deliberately absent from these lists:
-- the invoker report trigger calls it with the caller's own rights, so it
-- stays executable like `current_role()` — and it reveals nothing, because
-- the flag has no setter these roles can reach.)
select rls_test.ok(
  (select bool_and(not has_function_privilege('anon', f, 'execute'))
     from unnest(array[
       'public.admin_overview_svc(uuid)',
       'public.admin_analytics_svc(uuid, integer)',
       'public.admin_game_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_user_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_report_directory_svc(uuid, text, integer, integer)',
       'public.admin_comment_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_score_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_category_directory_svc(uuid)',
       'public.admin_moderation_log_svc(uuid, integer, integer)'
     ]) as f),
  'no privileged wrapper is executable by anon');
select rls_test.ok(
  (select bool_and(not has_function_privilege('authenticated', f, 'execute'))
     from unnest(array[
       'public.admin_overview_svc(uuid)',
       'public.admin_analytics_svc(uuid, integer)',
       'public.admin_game_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_user_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_report_directory_svc(uuid, text, integer, integer)',
       'public.admin_comment_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_score_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_category_directory_svc(uuid)',
       'public.admin_moderation_log_svc(uuid, integer, integer)'
     ]) as f),
  'no privileged wrapper is executable by authenticated');
select rls_test.ok(
  (select bool_and(has_function_privilege('service_role', f, 'execute'))
     from unnest(array[
       'public.admin_overview_svc(uuid)',
       'public.admin_analytics_svc(uuid, integer)',
       'public.admin_game_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_user_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_report_directory_svc(uuid, text, integer, integer)',
       'public.admin_comment_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_score_directory_svc(uuid, text, text, integer, integer)',
       'public.admin_category_directory_svc(uuid)',
       'public.admin_moderation_log_svc(uuid, integer, integer)'
     ]) as f),
  'every privileged read wrapper is executable by service_role');
select rls_test.ok(
  has_function_privilege('authenticated', 'public.admin_actor()', 'execute')
    and public.admin_actor() is null,
  'the bridge-actor helper stays callable (the invoker trigger needs it) and answers null outside the bridge');

-- Outside the bridge there is no actor, so the role helpers answer exactly
-- what they always have.
select rls_test.ok(
  public.admin_actor() is null,
  'outside the bridge there is no bridge actor'
);

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.ok(
  public.current_role() = 'user'::public.app_role,
  'an ordinary caller still resolves to the least-privileged role'
);
select rls_test.ok(
  public.admin_actor() is null,
  'a player sees no bridge actor');
select rls_test.denied(
  $$select public.admin_overview_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged overview');
select rls_test.denied(
  $$select public.admin_analytics_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged analytics');
select rls_test.denied(
  $$select * from public.admin_game_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged game directory');
select rls_test.denied(
  $$select * from public.admin_user_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged account directory');
select rls_test.denied(
  $$select * from public.admin_report_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged moderation queue');
select rls_test.denied(
  $$select * from public.admin_comment_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged comment list');
select rls_test.denied(
  $$select * from public.admin_score_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged score list');
select rls_test.denied(
  $$select * from public.admin_category_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged category list');
select rls_test.denied(
  $$select * from public.admin_moderation_log_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'a player cannot call the privileged audit trail');
select rls_test.denied(
  $$select public.admin_set_game_status_svc('99999999-9999-4999-8999-999999999999'::uuid, 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'archived', 'x')$$,
  'a player cannot call the privileged game moderation');
select rls_test.denied(
  $$select public.admin_set_report_status_svc('99999999-9999-4999-8999-999999999999'::uuid, 'dddddddd-1111-4111-8111-dddddddddddd', 'dismissed', 'x')$$,
  'a player cannot call the privileged report moderation');
select rls_test.denied(
  $$select public.admin_set_comment_hidden_svc('99999999-9999-4999-8999-999999999999'::uuid, 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', true, 'x')$$,
  'a player cannot call the privileged comment moderation');
select rls_test.denied(
  $$select public.admin_set_suspension_svc('99999999-9999-4999-8999-999999999999'::uuid, '22222222-2222-4222-8222-222222222222', true, 'x')$$,
  'a player cannot call the privileged suspension');

reset role;

select set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
set local role anon;

select rls_test.denied(
  $$select public.admin_overview_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'an anonymous caller cannot call the privileged overview');
select rls_test.denied(
  $$select * from public.admin_user_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)$$,
  'an anonymous caller cannot call the privileged account directory');

reset role;

set local role service_role;

-- A privileged call without a verified actor is the caller's own mistake, not
-- a grant question.
select rls_test.raises(
  $$select public.admin_overview_svc(null)$$,
  '22023',
  'a privileged call without a verified actor is refused');

-- Reads serve real data to an actor that holds no role row at all.
select rls_test.ok(
  (public.admin_overview_svc('99999999-9999-4999-8999-999999999999'::uuid) ->> 'totalUsers')::bigint >= 5,
  'the privileged overview counts the real profile rows without a staff row');
select rls_test.ok(
  jsonb_array_length(public.admin_overview_svc('99999999-9999-4999-8999-999999999999'::uuid) -> 'series') = 14,
  'the privileged overview series is fourteen real days');
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_game_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)
    where slug = 'fixture-admin-only' and status = 'draft'$$) = 1,
  'the privileged game directory includes a draft no other role can see');
select rls_test.ok(
  rls_test.count_rows($$
    select 1 from public.admin_user_directory_svc('99999999-9999-4999-8999-999999999999'::uuid)
    where id = '55555555-5555-4555-8555-555555555555'
      and is_suspended and email = 'erin@example.com'$$) = 1,
  'the privileged account directory carries the restricted columns');

-- Writes attribute the verified actor, not the key — and restore what they
-- change, so no later count can see this section.
select rls_test.ok(
  (public.admin_set_comment_hidden_svc('44444444-4444-4444-8444-444444444444'::uuid, :'bridge_comment'::uuid, true, 'Bridge fixture') ->> 'hidden') = 'true',
  'a privileged moderation write hides through the bridge');
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.moderation_actions
    where action = 'hide_comment' and moderator_id = '44444444-4444-4444-8444-444444444444'$$) = 1,
  'the privileged write records the verified actor, not the key');
select rls_test.ok(
  (public.admin_set_comment_hidden_svc('44444444-4444-4444-8444-444444444444'::uuid, :'bridge_comment'::uuid, false, null) ->> 'hidden') = 'false',
  'the privileged write restores without a reason');
select rls_test.raises(
  $$select public.admin_set_suspension_svc('44444444-4444-4444-8444-444444444444'::uuid, '44444444-4444-4444-8444-444444444444'::uuid, true, 'Locking myself out')$$,
  '22023',
  'the bridge still refuses self-suspension');
select rls_test.ok(
  (public.admin_set_suspension_svc('44444444-4444-4444-8444-444444444444'::uuid, :'bob'::uuid, true, 'Bridge fixture') ->> 'suspended') = 'true',
  'a privileged suspension works through the bridge');
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.admin_user_directory_svc('44444444-4444-4444-8444-444444444444'::uuid)
    where id = '22222222-2222-4222-8222-222222222222' and is_suspended$$) = 1,
  'the privileged suspension is visible through the privileged directory');
select rls_test.ok(
  (public.admin_set_suspension_svc('44444444-4444-4444-8444-444444444444'::uuid, :'bob'::uuid, false, null) ->> 'suspended') = 'false',
  'a privileged restoration works through the bridge');

reset role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Play sessions and server-verified scores
--
-- Two properties are asserted here, and they are the whole point of the
-- migration: a client cannot write a session or a score at all, and the number
-- that ends up in `scores` is the database's replay rather than the caller's
-- claim. The expected score (55 over 14 tiles and 3 clears) is arithmetic from
-- seed 1, not a value read back from the function.
-- ─────────────────────────────────────────────────────────────────────────────

\set greedy_run 'array[0,0,1,0,0,0,2,2,2,3,0,0,0,0]'
-- Seed 1's endless Stack 10 line: the retired perfect line (sixty tiles, 420
-- points, twenty-five clears) plus seven more into the pressure ramp, where the
-- last tile overflows: sixty-seven tiles, 435 points, twenty-six clears. The
-- shortest run past the old deck is the same line plus one tile: sixty-one
-- tiles for 420. See the Stack 10 section of docs/games/README.md.
\set stack10_endless 'array[0,0,1,0,0,0,2,2,2,3,0,0,2,0,2,2,0,0,2,0,2,2,3,2,2,2,2,3,0,1,0,0,0,0,0,2,1,2,1,0,0,2,0,0,0,0,0,0,1,1,1,1,2,3,1,1,2,1,1,0,0,2,3,0,1,0,1]'
\set stack10_past_deck 'array[0,0,1,0,0,0,2,2,2,3,0,0,2,0,2,2,0,0,2,0,2,2,3,2,2,2,2,3,0,1,0,0,0,0,0,2,1,2,1,0,0,2,0,0,0,0,0,0,1,1,1,1,2,3,1,1,2,1,1,0,1]'
-- Seed 1's Chain line: symbols 0,0,2,3,0,0,2,2,0,1 dealt into ten rounds, 55
-- taps, ten clears, 55 points. See the Chain section of docs/games/README.md.
\set chain_perfect 'array[0,0,0,0,0,2,0,0,2,3,0,0,2,3,0,0,0,2,3,0,0,0,0,2,3,0,0,2,0,0,2,3,0,0,2,2,0,0,2,3,0,0,2,2,0,0,0,2,3,0,0,2,2,0,1]'
-- Seed 1's endless line: twelve complete rounds then the tap that breaks the
-- chain. 78 correct taps, 78 points, twelve rounds cleared, 79 taps submitted.
-- The thirteenth round would show the sequence's first thirteen symbols; the
-- losing tap is a different pad. See the Chain section of docs/games/README.md.
\set chain_endless_line 'array[0,0,0,0,0,2,0,0,2,3,0,0,2,3,0,0,0,2,3,0,0,0,0,2,3,0,0,2,0,0,2,3,0,0,2,2,0,0,2,3,0,0,2,2,0,0,0,2,3,0,0,2,2,0,1,0,0,2,3,0,0,2,2,0,1,1,0,0,2,3,0,0,2,2,0,1,1,0,1]'
-- Seed 1's Memory Flash line: patterns [8], [8,6], [3,0,8], … rebuilt in draw
-- order, 55 taps, ten clears, 100 points. See the Memory Flash section of
-- docs/games/README.md.
\set memory_perfect 'array[8,8,6,3,0,8,6,2,8,5,13,0,7,1,8,3,14,15,13,7,2,15,2,11,14,8,10,0,11,2,1,10,5,12,3,13,3,14,13,9,11,8,0,4,15,1,4,7,2,10,6,9,5,14,11]'
-- Seed 1's endless line, past the retired tenth pattern: the same taps for rounds
-- one to eight, then the 5×5 patterns of rounds nine to twelve, and finally cell 0
-- on round thirteen — a cell that pattern does not light. Seventy-nine taps, twelve
-- cleared patterns, 120 points. Cut to seventy-eight taps it is a partial run, and
-- the SQL suite asserts both.
\set memory_endless 'array[8,8,6,3,0,8,6,2,8,5,13,0,7,1,8,3,14,15,13,7,2,15,2,11,14,8,10,0,11,2,1,10,5,12,3,13,22,15,5,18,6,21,4,11,7,4,3,20,22,6,13,19,10,5,16,3,16,6,12,22,0,21,8,4,2,15,19,3,23,15,24,21,6,7,11,17,9,22,0]'
-- The same line stopped after round eight: thirty-six taps, no clear to reach.
\set memory_eight_rounds 'array[8,8,6,3,0,8,6,2,8,5,13,0,7,1,8,3,14,15,13,7,2,15,2,11,14,8,10,0,11,2,1,10,5,12,3,13]'
-- Seed 1's One Move line: the winning cells of boards 1–12 in order, one tap each,
-- twelve restored boards, 120 points. See the One Move section of
-- docs/games/README.md.
\set one_move_perfect 'array[7,8,7,7,0,8,6,2,5,18,13,5]'
-- Seed 1's endless One Move line: twenty winning cells in order, then cell 0 on
-- board twenty-one — a board the retired game never showed. Twenty restored
-- boards, twenty-one taps, 200 points. Cut after the twelfth tap it is a partial
-- run, and the SQL suite asserts that too. See the One Move section of
-- docs/games/README.md.
\set one_move_endless 'array[7,8,7,7,0,8,6,2,5,18,13,5,11,21,33,20,20,9,47,39,0]'
-- Seed 1's legacy color-merge@1 deck line: forty-eight slides, ending on the
-- last one with 272 points; seed 15's legacy line locks the board after
-- forty-two slides for 184. Both are still verified exactly as they shipped.
\set color_merge_deck 'array[3,1,3,2,2,2,2,2,2,2,2,2,2,2,2,2,3,2,2,2,3,2,2,2,2,2,3,2,3,2,2,2,2,2,2,2,2,3,2,3,3,2,2,2,2,2,2,2]'
\set color_merge_locked 'array[1,1,1,1,1,3,1,3,1,1,3,1,1,3,1,1,1,1,1,1,1,1,1,3,1,1,1,3,1,1,3,0,1,3,1,1,3,1,0,1,0,1]'
-- Seed 1's endless color-merge@2 line: sixty-four slides, straight past the
-- retired forty-eight-slide deck, ending on the board's own lock with 468
-- points. Seed 15's endless line locks after fifty-two slides for 292. The
-- first forty-eight of seed 1's endless slides are *not* the legacy deck: the
-- spawn ramp deals different shades, which is what the refusal below checks.
\set color_merge_endless_one 'array[3,1,3,2,2,2,2,2,2,2,3,3,2,3,2,2,2,2,2,3,2,2,2,3,2,3,2,1,2,2,2,2,3,2,2,2,2,2,2,2,2,3,2,2,2,2,3,2,3,1,3,2,3,2,2,2,2,3,3,2,3,1,3,2]'
\set color_merge_endless_two 'array[1,1,1,1,1,1,1,3,1,1,3,1,1,1,1,1,1,3,1,1,1,3,1,1,0,1,1,1,3,1,1,1,0,1,1,1,1,1,1,1,1,1,0,1,1,1,1,1,3,1,0,1]'
-- Seed 1's legacy dont-touch@1 deck: the forty-one whites in board order, and
-- the nine whites of rows one to five followed by the black tile at cell 15.
-- The perfect line scores 410; the cautious line scores 90.
\set dont_touch_perfect 'array[2,3,6,7,9,10,12,13,14,16,17,18,19,20,21,22,23,24,25,27,29,30,31,32,33,34,36,37,38,39,40,41,42,43,45,51,52,54,55,57,59]'
\set dont_touch_loss 'array[2,3,6,7,9,10,12,13,14,15]'
-- Seed 1's endless conveyor: the fifty-six whites of rows one to twenty-five
-- (560 points, and cells 60-74 are past the legacy deck), and its opening row —
-- two whites, then the black tile at cell 1, for 20 points.
\set dont_touch_endless 'array[0,2,3,6,7,8,9,11,13,15,18,19,20,21,23,25,27,28,30,32,33,34,36,37,38,40,41,42,43,44,46,47,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,68,69,70,71,73,74]'
\set dont_touch_endless_loss 'array[0,2,1]'

-- A published, playable game — the only kind a run can be started for — plus one
-- that stays unpublished, so the refusal path has a subject. The sessions below
-- are fixtures only in the sense that the *superuser* may choose their seed:
-- `start_game_session` never may, which is exactly what makes the expected score
-- below arithmetic instead of whatever the verifier happens to return.
--
-- seed 1: tiles 1,7,9,2,2,5,4,6,7,8,3,4,3,5
--   greedy line 0,0,1,0,0,0,2,2,2,3,0,0,0,0 → 3 clears (3 tiles, 2 tiles, 3
--   tiles) = 20 + 15 + 20 = 55, then the 14th tile overflows column 0.
\set runnable_game 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa'
\set secret_game   'aaaaaaaa-5555-4555-8555-aaaaaaaaaaaa'
\set chain_game    'aaaaaaaa-6666-4666-8666-aaaaaaaaaaaa'
\set chain_endless_game 'aaaaaaaa-dddd-4ddd-8ddd-aaaaaaaaaaaa'
\set stack10_endless_game 'aaaaaaaa-eeee-4eee-8eee-aaaaaaaaaaaa'
\set memory_game   'aaaaaaaa-7777-4777-8777-aaaaaaaaaaaa'
\set memory_endless_game 'aaaaaaaa-1a1a-4a1a-8a1a-aaaaaaaaaaaa'
\set one_move_game 'aaaaaaaa-8888-4888-8888-aaaaaaaaaaaa'
\set one_move_endless_game 'aaaaaaaa-8899-4899-8899-aaaaaaaaaaaa'
\set pending_session   'cccccccc-1111-4111-8111-cccccccccccc'
\set expired_session   'cccccccc-2222-4222-8222-cccccccccccc'
\set abandoned_session 'cccccccc-3333-4333-8333-cccccccccccc'
\set guest_session     'cccccccc-4444-4444-8444-cccccccccccc'
\set stack10_endless_session       'cccccccc-7777-4777-8777-cccccccccccc'
\set stack10_endless_two_session   'cccccccc-8888-4888-8888-cccccccccccc'
\set stack10_endless_guest_session 'cccccccc-9999-4999-8999-cccccccccccc'
\set old_rules_session 'cccccccc-5555-4555-8555-cccccccccccc'
\set bob_session       'cccccccc-6666-4666-8666-cccccccccccc'
\set chain_session       'dddddddd-1111-4111-8111-dddddddddddd'
\set chain_loss_session  'dddddddd-2222-4222-8222-dddddddddddd'
\set chain_guest_session 'dddddddd-4444-4444-8444-dddddddddddd'
\set chain_old_session   'dddddddd-5555-4555-8555-dddddddddddd'
\set chain_endless_session      'dddddddd-3333-4333-8333-dddddddddddd'
\set chain_endless_open_session 'dddddddd-6666-4666-8666-dddddddddddd'
\set memory_session       'eeeeeeee-1111-4111-8111-eeeeeeeeeeee'
\set memory_loss_session  'eeeeeeee-2222-4222-8222-eeeeeeeeeeee'
\set memory_guest_session 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'
\set memory_old_session   'eeeeeeee-5555-4555-8555-eeeeeeeeeeee'
\set memory_endless_session      'eeeeeeee-3333-4333-8333-eeeeeeeeeeee'
\set memory_endless_open_session 'eeeeeeee-6666-4666-8666-eeeeeeeeeeee'
\set memory_endless_guest_session 'eeeeeeee-7777-4777-8777-eeeeeeeeeeee'
\set one_move_session       'ffffffff-1111-4111-8111-ffffffffffff'
\set one_move_loss_session  'ffffffff-2222-4222-8222-ffffffffffff'
\set one_move_guest_session 'ffffffff-4444-4444-8444-ffffffffffff'
\set one_move_old_session   'ffffffff-5555-4555-8555-ffffffffffff'
\set one_move_endless_session      'ffffffff-3333-4333-8333-ffffffffffff'
\set one_move_endless_open_session 'ffffffff-6666-4666-8666-ffffffffffff'
\set one_move_endless_guest_session 'ffffffff-7777-4777-8777-ffffffffffff'
\set color_merge_game           'aaaaaaaa-bbbb-4bbb-8bbb-aaaaaaaaaaaa'
\set color_merge_session        '99999999-1111-4111-8111-999999999999'
\set color_merge_loss_session   '99999999-2222-4222-8222-999999999999'
\set color_merge_guest_session  '99999999-4444-4444-8444-999999999999'
\set color_merge_old_session    '99999999-5555-4555-8555-999999999999'
\set color_merge_locked_session '99999999-6666-4666-8666-999999999999'
\set color_merge_endless_session       '99999999-3333-4333-8333-999999999999'
\set color_merge_endless_two_session   '99999999-7777-4777-8777-999999999999'
\set color_merge_endless_guest_session '99999999-8888-4888-8888-999999999999'
\set dont_touch_game          'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
\set dont_touch_session       '77777777-1111-4111-8111-777777777777'
\set dont_touch_loss_session  '77777777-2222-4222-8222-777777777777'
\set dont_touch_guest_session '77777777-4444-4444-8444-777777777777'
\set dont_touch_old_session   '77777777-5555-4555-8555-777777777777'
\set dont_touch_empty_session '77777777-6666-4666-8666-777777777777'
\set dont_touch_endless_session       '77777777-3333-4333-8333-777777777777'
\set dont_touch_endless_loss_session  '77777777-7777-4777-8777-777777777777'
\set dont_touch_endless_empty_session '77777777-8888-4888-8888-777777777777'
\set seven_second_game          '88888888-aaaa-4aaa-8aaa-888888888888'
\set seven_second_session       '88888888-1111-4111-8111-888888888888'
\set seven_second_line_session  '88888888-2222-4222-8222-888888888888'
\set seven_second_guest_session '88888888-4444-4444-8444-888888888888'
\set seven_second_old_session   '88888888-5555-4555-8555-888888888888'
\set seven_second_empty_session '88888888-6666-4666-8666-888888888888'
\set seven_second_done_session  '88888888-7777-4777-8777-888888888888'
-- Queens. Seed 1's first board (5×5) is solved by cells 1, 8, 10, 19, 22, each
-- tapped twice (an X, then a Queen); its second (6×6) by 4, 7, 15, 18, 29, 32.
-- The line below solves board one, cycles cell 4 of board two through X, Queen
-- and empty, then places three Queens off the solution: 50 points, nineteen
-- taps, and the third mistake ends the run. See the Queens section of
-- docs/games/README.md.
\set queens_line 'array[1,1,8,8,10,10,19,19,22,22,4,4,4,0,0,1,1,2,2]'
-- Boards one and two solved: 50 + 60 points. The run is still live, so this is
-- the player ending it.
\set queens_two_boards 'array[1,1,8,8,10,10,19,19,22,22,4,4,7,7,15,15,18,18,29,29,32,32]'
\set queens_game           'c0c0c0c0-aaaa-4aaa-8aaa-c0c0c0c0c0c0'
\set queens_session        'c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0'
\set queens_open_session   'c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'
\set queens_guest_session  'c0c0c0c0-4444-4444-8444-c0c0c0c0c0c0'
\set queens_old_session    'c0c0c0c0-5555-4555-8555-c0c0c0c0c0c0'
-- Zip. Seed 1's first two solution paths (both 5×5) are below. The line solves
-- board one, starts board two, cuts back once and stops: 50 points, thirty-one
-- cells. See the Zip section of docs/games/README.md.
\set zip_line 'array[8,7,6,5,10,15,20,21,16,11,12,17,22,23,24,19,18,13,14,9,4,3,2,1,0,20,15,10,5,15,10]'
\set zip_board_one 'array[8,7,6,5,10,15,20,21,16,11,12,17,22,23,24,19,18,13,14,9,4,3,2,1,0]'
\set zip_two_boards 'array[8,7,6,5,10,15,20,21,16,11,12,17,22,23,24,19,18,13,14,9,4,3,2,1,0,20,15,10,5,0,1,6,11,12,7,2,3,4,9,8,13,14,19,18,17,16,21,22,23,24]'
\set zip_game          'd1d1d1d1-aaaa-4aaa-8aaa-d1d1d1d1d1d1'
\set zip_session       'd1d1d1d1-1111-4111-8111-d1d1d1d1d1d1'
\set zip_open_session  'd1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'
\set zip_late_session  'd1d1d1d1-3333-4333-8333-d1d1d1d1d1d1'
\set zip_guest_session 'd1d1d1d1-4444-4444-8444-d1d1d1d1d1d1'
\set zip_old_session   'd1d1d1d1-5555-4555-8555-d1d1d1d1d1d1'
-- 8 Puzzle. Seed 1's first board is 1 6 _ / 5 3 2 / 4 7 8, solved by sliding the
-- tiles on cells 5, 4, 1, 2, 5, 4, 3, 6, 7, 8; its second by 4, 7, 6, 3, 0, 1,
-- 2, 5, 8. The line solves board one, slides twice more and stops: 10 points,
-- twelve slides. See the 8 Puzzle section of docs/games/README.md.
\set eight_line 'array[5,4,1,2,5,4,3,6,7,8,4,7]'
\set eight_board_one 'array[5,4,1,2,5,4,3,6,7,8]'
\set eight_two_boards 'array[5,4,1,2,5,4,3,6,7,8,4,7,6,3,0,1,2,5,8]'
\set eight_game          'e2e2e2e2-aaaa-4aaa-8aaa-e2e2e2e2e2e2'
\set eight_session       'e2e2e2e2-1111-4111-8111-e2e2e2e2e2e2'
\set eight_open_session  'e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'
\set eight_late_session  'e2e2e2e2-3333-4333-8333-e2e2e2e2e2e2'
\set eight_guest_session 'e2e2e2e2-4444-4444-8444-e2e2e2e2e2e2'
\set eight_old_session   'e2e2e2e2-5555-4555-8555-e2e2e2e2e2e2'
-- Saved progress: Alice's unfinished Queens run, Bob's, and a timed Zip run.
\set progress_session       'f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'
\set progress_bob_session   'f3f3f3f3-2222-4222-8222-f3f3f3f3f3f3'
\set progress_timed_session 'f3f3f3f3-3333-4333-8333-f3f3f3f3f3f3'
-- Tango. Seed 1's first board starts with a moon on cell 0 and is filled by the
-- taps in :tango_board_one (once for a sun, twice for a moon); the second by
-- :tango_board_two. The line solves board one, cycles cell 0 of board two to a
-- moon and stops: 60 points, forty-two taps. See the Tango section of
-- docs/games/README.md.
\set tango_line 'array[1,2,3,3,5,6,6,7,9,9,10,10,11,12,13,13,14,14,15,16,18,19,19,20,20,22,22,23,24,24,26,27,27,28,29,29,30,32,32,34,0,0]'
\set tango_board_one 'array[1,2,3,3,5,6,6,7,9,9,10,10,11,12,13,13,14,14,15,16,18,19,19,20,20,22,22,23,24,24,26,27,27,28,29,29,30,32,32,34]'
\set tango_two_boards 'array[1,2,3,3,5,6,6,7,9,9,10,10,11,12,13,13,14,14,15,16,18,19,19,20,20,22,22,23,24,24,26,27,27,28,29,29,30,32,32,34,0,1,1,2,3,3,5,5,6,6,11,11,12,13,13,14,14,16,16,19,19,20,21,21,22,22,23,24,24,25,26,26,27,28,29,29,30,30,31,32,32,33,34,34,35]'
\set tango_game          'a7a7a7a7-aaaa-4aaa-8aaa-a7a7a7a7a7a7'
\set tango_session       'a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7'
\set tango_open_session  'a7a7a7a7-2222-4222-8222-a7a7a7a7a7a7'
\set tango_late_session  'a7a7a7a7-3333-4333-8333-a7a7a7a7a7a7'
\set tango_guest_session 'a7a7a7a7-4444-4444-8444-a7a7a7a7a7a7'
\set tango_old_session   'a7a7a7a7-5555-4555-8555-a7a7a7a7a7a7'

insert into public.games (id, owner_id, slug, title, status, published_at, runtime, playable, category_id) values
  (:'runnable_game', :'alice', 'fixture-runnable', 'Fixture Runnable', 'published', now(), 'stack-10', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'secret_game',   :'alice', 'fixture-secret',   'Fixture Secret',   'draft',     null, 'stack-10', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'chain_game',    :'alice', 'fixture-chain',    'Fixture Chain',    'published', now(), 'chain', true,
   (select id from public.categories where slug = 'reaction')),
  (:'chain_endless_game', :'alice', 'fixture-chain-endless', 'Fixture Chain Endless', 'published', now(), 'chain', true,
   (select id from public.categories where slug = 'reaction')),
  (:'stack10_endless_game', :'alice', 'fixture-stack-endless', 'Fixture Stack 10 Endless', 'published', now(), 'stack-10', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'memory_game',    :'alice', 'fixture-memory',   'Fixture Memory',   'published', now(), 'memory-flash', true,
   (select id from public.categories where slug = 'memory')),
  (:'memory_endless_game', :'alice', 'fixture-memory-endless', 'Fixture Memory Endless', 'published', now(), 'memory-flash', true,
   (select id from public.categories where slug = 'memory')),
  (:'one_move_game',  :'alice', 'fixture-one-move', 'Fixture One Move', 'published', now(), 'one-move', true,
   (select id from public.categories where slug = 'logic')),
  (:'one_move_endless_game', :'alice', 'fixture-one-move-endless', 'Fixture One Move Endless', 'published', now(), 'one-move', true,
   (select id from public.categories where slug = 'logic')),
  (:'color_merge_game', :'alice', 'fixture-color-merge', 'Fixture Color Merge', 'published', now(), 'color-merge', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'dont_touch_game', :'alice', 'fixture-dont-touch', 'Fixture Don''t Touch the Black', 'published', now(), 'dont-touch', true,
   (select id from public.categories where slug = 'arcade')),
  (:'seven_second_game', :'alice', 'fixture-seven-second', 'Fixture 7 Second', 'published', now(), 'seven-second', true,
   (select id from public.categories where slug = 'daily')),
  (:'queens_game', :'alice', 'fixture-queens', 'Fixture Queens', 'published', now(), 'queens', true,
   (select id from public.categories where slug = 'logic')),
  (:'zip_game', :'alice', 'fixture-zip', 'Fixture Zip', 'published', now(), 'zip', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'eight_game', :'alice', 'fixture-eight-puzzle', 'Fixture 8 Puzzle', 'published', now(), 'eight-puzzle', true,
   (select id from public.categories where slug = 'puzzle')),
  (:'tango_game', :'alice', 'fixture-tango', 'Fixture Tango', 'published', now(), 'tango', true,
   (select id from public.categories where slug = 'logic'));

-- Runs that have been open for five minutes, which is what makes a claimed
-- 45-second duration credible: a run cannot have taken longer than the session
-- has existed, and that check is one of the assertions below.
insert into public.game_sessions (id, game_id, user_id, seed, rules_version, started_at, expires_at, abandoned_at) values
  (:'pending_session',   :'runnable_game', :'alice', 1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'expired_session',   :'runnable_game', :'alice', 1, 'stack-10@1', now() - interval '3 hours', now() - interval '1 hour', null),
  (:'abandoned_session', :'runnable_game', :'alice', 1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', now()),
  (:'guest_session',     :'runnable_game', null,     1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'old_rules_session', :'runnable_game', :'alice', 1, 'stack-10@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'bob_session',       :'runnable_game', :'bob',   1, 'stack-10@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Endless Stack 10 fixtures. Alice plays seed 1 through the retired sixty-tile
  -- deck and into the ramp; the second session holds the shortest run past it,
  -- and a guest plays the full endless line.
  (:'stack10_endless_session',       :'stack10_endless_game', :'alice', 1, 'stack-10@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'stack10_endless_two_session',   :'stack10_endless_game', :'alice', 1, 'stack-10@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'stack10_endless_guest_session', :'stack10_endless_game', null,     1, 'stack-10@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Chain fixtures under the same rules. Seed 1 deals symbols 0,0,2,3,0,0,2,2,0,1:
  -- round 1 is [0], round 2 [0,0], round 3 [0,0,2], and so on to ten rounds.
  (:'chain_session',       :'chain_game', :'alice', 1, 'chain@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_loss_session',  :'chain_game', :'alice', 1, 'chain@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_guest_session', :'chain_game', null,     1, 'chain@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_old_session',   :'chain_game', :'alice', 1, 'chain@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Endless Chain fixtures. Bob records the twelve-round line; Alice's open
  -- session is the subject of the refusals that leave a session open, and is
  -- recorded at the end with the same line.
  (:'chain_endless_session',      :'chain_endless_game', :'alice', 1, 'chain@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'chain_endless_open_session', :'chain_endless_game', :'alice', 1, 'chain@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Memory Flash fixtures. Seed 1 flashes [8], then [8,6], then [3,0,8]: round
  -- one is one cell, round two two cells, and so on to ten rounds.
  (:'memory_session',       :'memory_game', :'alice', 1, 'memory-flash@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'memory_loss_session',  :'memory_game', :'alice', 1, 'memory-flash@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'memory_guest_session', :'memory_game', null,     1, 'memory-flash@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'memory_old_session',   :'memory_game', :'alice', 1, 'memory-flash@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Endless Memory Flash fixtures. Seed 1 under memory-flash@2: rounds one to
  -- eight are the retired game's patterns, round nine is drawn on the 5×5 board,
  -- and a run ends only on a mistake or the submission bound.
  (:'memory_endless_session',       :'memory_endless_game', :'alice', 1, 'memory-flash@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'memory_endless_open_session',  :'memory_endless_game', :'alice', 1, 'memory-flash@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'memory_endless_guest_session', :'memory_endless_game', null,     1, 'memory-flash@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- One Move fixtures. Seed 1 wins on cells 7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5:
  -- a 3×3 board for the first four, 4×4 for the next four, 5×5 for the last four.
  (:'one_move_session',       :'one_move_game', :'alice', 1, 'one-move@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'one_move_loss_session',  :'one_move_game', :'alice', 1, 'one-move@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'one_move_guest_session', :'one_move_game', null,     1, 'one-move@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'one_move_old_session',   :'one_move_game', :'alice', 1, 'one-move@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Endless One Move fixtures. Seed 1 under one-move@2: levels one to twelve are
  -- the retired game's boards, level thirteen is the first 6×6 board, and a run
  -- ends only on a miss or the submission bound.
  (:'one_move_endless_session',       :'one_move_endless_game', :'alice', 1, 'one-move@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'one_move_endless_open_session',  :'one_move_endless_game', :'alice', 1, 'one-move@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'one_move_endless_guest_session', :'one_move_endless_game', null,     1, 'one-move@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Color Merge fixtures. Seed 1 opens with two shade-1 tiles side by side;
  -- seed 15's legacy line locks the board after forty-two slides.
  (:'color_merge_session',        :'color_merge_game', :'alice', 1,  'color-merge@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'color_merge_loss_session',   :'color_merge_game', :'alice', 1,  'color-merge@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'color_merge_guest_session',  :'color_merge_game', null,     1,  'color-merge@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'color_merge_old_session',    :'color_merge_game', :'alice', 1,  'color-merge@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'color_merge_locked_session', :'color_merge_game', :'alice', 15, 'color-merge@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Endless Color Merge fixtures: no deck, so a run ends only when its board
  -- locks. Seed 1's line survives past slide forty-eight; seed 15's locks at
  -- fifty-two; and a guest run is verified and left unranked like any other.
  (:'color_merge_endless_session',       :'color_merge_game', :'alice', 1,  'color-merge@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'color_merge_endless_two_session',   :'color_merge_game', :'alice', 15, 'color-merge@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'color_merge_endless_guest_session', :'color_merge_game', null,     1,  'color-merge@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Don't Touch the Black fixtures. Seed 1's deck opens black, black, white; its
  -- forty-one whites are the perfect line, and cell 15 is the black tile that
  -- ends the cautious one.
  (:'dont_touch_session',       :'dont_touch_game', :'alice', 1, 'dont-touch@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'dont_touch_loss_session',  :'dont_touch_game', :'alice', 1, 'dont-touch@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'dont_touch_guest_session', :'dont_touch_game', null,     1, 'dont-touch@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'dont_touch_old_session',   :'dont_touch_game', :'alice', 1, 'dont-touch@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'dont_touch_empty_session', :'dont_touch_game', :'alice', 1, 'dont-touch@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Endless Don't Touch the Black fixtures. Alice plays seed 1 under dont-touch@2:
  -- the whites of the first twenty-five rows, the opening row's black ending, and
  -- an immediate stop.
  (:'dont_touch_endless_session',       :'dont_touch_game', :'alice', 1, 'dont-touch@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'dont_touch_endless_loss_session',  :'dont_touch_game', :'alice', 1, 'dont-touch@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'dont_touch_endless_empty_session', :'dont_touch_game', :'alice', 1, 'dont-touch@2', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- 7 Second fixtures. Seed 1's first four challenges want buttons 0, 0, 2, 1;
  -- the line [0,1,2,1] clears three of them for thirty points. The done session
  -- carries *today's* seed and is already completed, which is what consumes
  -- Alice's daily attempt below.
  (:'seven_second_session',       :'seven_second_game', :'alice', 1, 'seven-second@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'seven_second_line_session',  :'seven_second_game', :'alice', 1, 'seven-second@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'seven_second_guest_session', :'seven_second_game', null,     1, 'seven-second@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'seven_second_old_session',   :'seven_second_game', :'alice', 1, 'seven-second@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Seed 2, so the empty-line test is a different day's deck from the one the
  -- ledger's one-score-a-day guard is about.
  (:'seven_second_empty_session', :'seven_second_game', :'alice', 2, 'seven-second@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Queens fixtures, all on seed 1.
  (:'queens_session',       :'queens_game', :'alice', 1, 'queens@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'queens_open_session',  :'queens_game', :'alice', 1, 'queens@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'queens_guest_session', :'queens_game', null,     1, 'queens@1', now() - interval '5 minutes', now() + interval '2 hours', null),
  (:'queens_old_session',   :'queens_game', :'alice', 1, 'queens@0', now() - interval '5 minutes', now() + interval '2 hours', null),
  -- Zip fixtures, all on seed 1. Zip's verifier times the run from the session,
  -- so these started thirty seconds ago — inside the sixty-second opening clock —
  -- except the late one, which started two minutes ago.
  (:'zip_session',       :'zip_game', :'alice', 1, 'zip@1', now() - interval '30 seconds', now() + interval '2 hours', null),
  (:'zip_open_session',  :'zip_game', :'alice', 1, 'zip@1', now() - interval '30 seconds', now() + interval '2 hours', null),
  (:'zip_late_session',  :'zip_game', :'alice', 1, 'zip@1', now() - interval '2 minutes',  now() + interval '2 hours', null),
  (:'zip_guest_session', :'zip_game', null,     1, 'zip@1', now() - interval '30 seconds', now() + interval '2 hours', null),
  (:'zip_old_session',   :'zip_game', :'alice', 1, 'zip@0', now() - interval '30 seconds', now() + interval '2 hours', null),
  -- 8 Puzzle fixtures, all on seed 1 and timed like Zip's: thirty seconds into
  -- the sixty-second opening clock, except the late one at a hundred seconds.
  (:'eight_session',       :'eight_game', :'alice', 1, 'eight-puzzle@1', now() - interval '30 seconds',  now() + interval '2 hours', null),
  (:'eight_open_session',  :'eight_game', :'alice', 1, 'eight-puzzle@1', now() - interval '30 seconds',  now() + interval '2 hours', null),
  (:'eight_late_session',  :'eight_game', :'alice', 1, 'eight-puzzle@1', now() - interval '100 seconds', now() + interval '2 hours', null),
  (:'eight_guest_session', :'eight_game', null,     1, 'eight-puzzle@1', now() - interval '30 seconds',  now() + interval '2 hours', null),
  (:'eight_old_session',   :'eight_game', :'alice', 1, 'eight-puzzle@0', now() - interval '30 seconds',  now() + interval '2 hours', null),
  -- Saved-progress fixtures. Alice's Queens run expires within the hour, so a
  -- save is seen extending it to twelve hours.
  (:'progress_session',       :'queens_game', :'alice', 1, 'queens@1', now() - interval '5 minutes',  now() + interval '1 hour',  null),
  (:'progress_bob_session',   :'queens_game', :'bob',   1, 'queens@1', now() - interval '5 minutes',  now() + interval '1 hour',  null),
  (:'progress_timed_session', :'zip_game',    :'alice', 1, 'zip@1',    now() - interval '30 seconds', now() + interval '2 hours', null),
  -- Tango fixtures, all on seed 1 and timed like Zip's: thirty seconds into the
  -- two-minute opening clock, except the late one at two hundred seconds.
  (:'tango_session',       :'tango_game', :'alice', 1, 'tango@1', now() - interval '30 seconds',  now() + interval '2 hours', null),
  (:'tango_open_session',  :'tango_game', :'alice', 1, 'tango@1', now() - interval '30 seconds',  now() + interval '2 hours', null),
  (:'tango_late_session',  :'tango_game', :'alice', 1, 'tango@1', now() - interval '200 seconds', now() + interval '2 hours', null),
  (:'tango_guest_session', :'tango_game', null,     1, 'tango@1', now() - interval '30 seconds',  now() + interval '2 hours', null),
  (:'tango_old_session',   :'tango_game', :'alice', 1, 'tango@0', now() - interval '30 seconds',  now() + interval '2 hours', null);

insert into public.game_sessions
  (id, game_id, user_id, seed, rules_version, started_at, expires_at, completed_at, verified_score, verified_digest)
values (:'seven_second_done_session', :'seven_second_game', :'alice', public.seven_second_seed(),
        'seven-second@1', now() - interval '5 minutes', now() + interval '2 hours',
        now() - interval '1 minute', 0, md5('daily-fixture'));

-- The generator, asserted directly: seed 1's twelve winning cells are the ones
-- the client engine computes and the ones the verifier replays. A drift here is
-- a drift in both copies, and every honest One Move run would be refused.
select rls_test.ok(
  (select array_agg(public.one_move_center(1, level) order by level) = array[7,8,7,7,0,8,6,2,5,18,13,5]::integer[]
     from generate_series(1, public.one_move_levels()) as level),
  'the One Move generator draws seed 1''s twelve winning cells'
);
select rls_test.ok(
  (select array_agg(public.one_move_center(9223372036854775807, level) order by level) = array[1,8,6,6,5,4,5,0,24,13,3,7]::integer[]
     from generate_series(1, public.one_move_levels()) as level),
  'the One Move generator replays a full-width seed exactly'
);
select rls_test.ok(
  public.one_move_size(1) = 3 and public.one_move_size(5) = 4 and public.one_move_size(9) = 5,
  'a One Move board grows from 3×3 to 4×4 to 5×5'
);
select rls_test.ok(
  (select array_agg(public.one_move_endless_center(1, level) order by level)
          = array[7,8,7,7,0,8,6,2,5,18,13,5,11,21,33,20,20,9,47,39]::integer[]
     from generate_series(1, 20) as level),
  'the endless One Move generator draws seed 1''s twenty winning cells'
);
select rls_test.ok(
  public.one_move_side(13) = 6 and public.one_move_cells_at(13) = 36
    and public.one_move_side(17) = 7 and public.one_move_cells_at(21) = 64,
  'an endless One Move board grows past 5×5 and keeps growing'
);
select rls_test.ok(
  public.one_move_endless_center(9223372036854775807, 20) = 32,
  'the endless One Move generator replays a full-width seed exactly'
);
-- The Queens solution generator, asserted directly: seed 1's first four
-- solutions are the ones the client engine draws and grows its regions around.
select rls_test.ok(
  public.queens_solution(1, 1) = array[1,3,0,4,2]
    and public.queens_solution(1, 2) = array[4,1,3,0,5,2]
    and public.queens_solution(1, 3) = array[0,3,5,1,4,2]
    and public.queens_solution(1, 4) = array[0,6,1,4,2,5,3],
  'the Queens generator draws seed 1''s first four solutions'
);
select rls_test.ok(
  public.queens_solution(9223372036854775807, 1) = array[4,1,3,0,2]
    and public.queens_solution(9223372036854775807, 11) = array[5,8,3,0,2,6,1,4,7],
  'the Queens generator replays a full-width seed exactly'
);
select rls_test.ok(
  public.queens_solution(0, 11) = public.queens_solution(2654435769, 11),
  'a zero Queens seed draws the fallback state''s boards'
);
select rls_test.ok(
  public.queens_side(1) = 5 and public.queens_side(2) = 6 and public.queens_side(4) = 7
    and public.queens_side(7) = 8 and public.queens_side(11) = 9 and public.queens_side(500) = 9,
  'a Queens board grows from 5×5 to 9×9 and stays there'
);
select rls_test.ok(
  (select bool_and(
            (select count(distinct c) from unnest(public.queens_solution(42, level)) c)
              = public.queens_side(level)
            and not exists (
              select 1 from generate_series(1, public.queens_side(level) - 1) r
               where abs((public.queens_solution(42, level))[r] - (public.queens_solution(42, level))[r + 1]) < 2))
     from generate_series(1, 30) as level),
  'every Queens solution has one Queen per column and no two touching'
);
select rls_test.raises(
  $$select public.queens_solution(1, 0)$$,
  '22023', 'a Queens level before the first is a request error'
);
-- The Zip path generator, asserted directly: seed 1's first three solution paths
-- and a full-width seed's first 7×7 path are the ones the client engine draws.
select rls_test.ok(
  public.zip_path(1, 1) = array[8,7,6,5,10,15,20,21,16,11,12,17,22,23,24,19,18,13,14,9,4,3,2,1,0]
    and public.zip_path(1, 2) = array[20,15,10,5,0,1,6,11,12,7,2,3,4,9,8,13,14,19,18,17,16,21,22,23,24]
    and public.zip_path(1, 3) = array[14,8,7,6,0,1,2,3,9,15,16,10,4,5,11,17,23,29,35,34,33,32,26,27,28,22,21,20,19,13,12,18,24,25,31,30],
  'the Zip generator draws seed 1''s first three solution paths'
);
select rls_test.ok(
  public.zip_path(9223372036854775807, 9) = array[8,7,14,15,22,21,28,29,36,35,42,43,44,45,38,37,30,23,24,31,32,25,26,33,40,39,46,47,48,41,34,27,20,19,12,13,6,5,4,11,18,17,16,9,10,3,2,1,0],
  'the Zip generator replays a full-width seed exactly'
);
select rls_test.ok(
  public.zip_path(0, 9) = public.zip_path(2654435769, 9),
  'a zero Zip seed draws the fallback state''s boards'
);
select rls_test.ok(
  public.zip_side(1) = 5 and public.zip_side(3) = 6 and public.zip_side(9) = 7 and public.zip_side(500) = 7
    and public.zip_budget_ms(0) = 60000 and public.zip_budget_ms(1) = 85000
    and public.zip_budget_ms(3) = 140000,
  'a Zip board grows from 5×5 to 7×7, and the clock adds five seconds a row'
);
select rls_test.ok(
  (select bool_and(
            (select count(distinct c) from unnest(public.zip_path(42, level)) c)
              = public.zip_side(level) * public.zip_side(level))
     from generate_series(1, 12) as level),
  'every Zip solution path visits every cell once'
);
select rls_test.raises(
  $$select public.zip_path(1, 0)$$,
  '22023', 'a Zip level before the first is a request error'
);
-- The 8 Puzzle board generator, asserted directly against the client engine.
select rls_test.ok(
  public.eight_puzzle_board(1, 1) = array[1,6,0,5,3,2,4,7,8]
    and public.eight_puzzle_board(1, 2) = array[4,1,2,0,7,3,8,5,6],
  'the 8 Puzzle generator draws seed 1''s first two boards'
);
select rls_test.ok(
  public.eight_puzzle_board(9223372036854775807, 1) = array[2,3,6,1,0,8,7,4,5]
    and public.eight_puzzle_board(9223372036854775807, 30) = array[1,3,7,6,0,4,8,5,2],
  'the 8 Puzzle generator replays a full-width seed exactly'
);
select rls_test.ok(
  public.eight_puzzle_board(0, 5) = public.eight_puzzle_board(2654435769, 5),
  'a zero 8 Puzzle seed draws the fallback state''s boards'
);
select rls_test.ok(
  public.eight_puzzle_scramble(1) = 10 and public.eight_puzzle_scramble(2) = 13
    and public.eight_puzzle_scramble(500) = 80
    and public.eight_puzzle_budget_ms(0) = 60000 and public.eight_puzzle_budget_ms(4) = 120000,
  'an 8 Puzzle scramble grows to eighty steps, and the clock adds fifteen seconds a board'
);
select rls_test.ok(
  (select bool_and(public.eight_puzzle_board(7, level) <> array[1,2,3,4,5,6,7,8,0]
                   and (select count(distinct t) from unnest(public.eight_puzzle_board(7, level)) t) = 9)
     from generate_series(1, 40) as level),
  'every 8 Puzzle board holds each tile once and is never already solved'
);
select rls_test.raises(
  $$select public.eight_puzzle_board(1, 0)$$,
  '22023', 'an 8 Puzzle level before the first is a request error'
);
-- The Tango board generator, asserted directly against the client engine: the
-- solution, then the cells the board starts with (1 sun, 2 moon, 0 empty).
select rls_test.ok(
  public.tango_draw(1, 1) = array[2,1,1,2,2,1,2,1,1,2,2,1,1,2,2,1,1,2,1,2,2,1,2,1,2,1,1,2,1,2,1,2,2,1,1,2,2,0,0,0,2,0,0,0,1,0,0,0,0,0,0,0,0,2,0,0,0,1,0,0,0,1,0,0,0,0,0,2,0,1,0,2]
    and public.tango_draw(1, 2) = array[1,2,1,2,1,2,2,1,1,2,1,2,1,2,2,1,2,1,1,2,1,2,2,1,2,1,2,1,1,2,2,1,2,1,2,1,0,0,0,0,1,0,0,1,1,2,1,0,0,0,0,1,0,1,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
  'the Tango generator draws seed 1''s first two boards'
);
select rls_test.ok(
  (public.tango_draw(9223372036854775807, 1))[1:36] = array[1,2,1,1,2,2,2,1,2,1,1,2,2,1,2,2,1,1,1,2,1,2,2,1,1,2,1,1,2,2,2,1,2,2,1,1],
  'the Tango generator replays a full-width seed exactly'
);
select rls_test.ok(
  public.tango_draw(0, 3) = public.tango_draw(2654435769, 3),
  'a zero Tango seed draws the fallback state''s boards'
);
select rls_test.ok(
  public.tango_givens(1) = 9 and public.tango_givens(2) = 8 and public.tango_givens(7) = 3
    and public.tango_givens(500) = 3
    and public.tango_budget_ms(0) = 120000 and public.tango_budget_ms(2) = 210000,
  'a Tango board starts with nine cells down to three, and the clock adds 45 s a board'
);
select rls_test.ok(
  (select bool_and(
            (select count(*) from unnest((public.tango_draw(5, level))[1:36]) v where v = 1) = 18
            and (select count(*) from unnest((public.tango_draw(5, level))[37:72]) v where v <> 0)
                = public.tango_givens(level))
     from generate_series(1, 20) as level),
  'every Tango solution is half suns, and every board starts with its givens'
);
select rls_test.raises(
  $$select public.tango_draw(1, 0)$$,
  '22023', 'a Tango level before the first is a request error'
);
-- The Color Merge generator, asserted directly: the opening board and the
-- spawns after it are the ones the client engine computes and the verifier
-- replays. A drift here is a drift in both copies.
select rls_test.ok(
  public.color_merge_board(1) = array[0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0]::integer[],
  'the Color Merge generator deals seed 1''s opening board'
);
select rls_test.ok(
  public.color_merge_board(9223372036854775807) = array[0,0,1,0,0,0,0,0,2,0,0,0,0,0,0,0]::integer[],
  'the Color Merge generator deals a full-width seed exactly'
);
select rls_test.ok(
  public.color_merge_slide(array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::integer[], 3)
    = array[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::integer[],
  'a slide of an empty Color Merge board changes nothing'
);
select rls_test.ok(
  public.color_merge_slide(array[1,0,0,2,0,0,0,0,0,0,0,0,0,0,0,0]::integer[], 3)
    = array[1,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::integer[],
  'a Color Merge slide compacts toward the edge it is slid to'
);
select rls_test.ok(
  public.color_merge_slide(array[1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0]::integer[], 3)
    = array[2,2,0,0,0,0,0,0,0,0,0,0,0,0,0,0]::integer[]
  and public.color_merge_gain(array[1,1,1,1,0,0,0,0,0,0,0,0,0,0,0,0]::integer[], 3) = 8,
  'each Color Merge tile merges once per slide, and the gain is the merge'
);
-- The endless Color Merge generator and its ramp, asserted directly. The spawn
-- ramp is the whole of the difficulty: a chance that rises to a ceiling, and a
-- promoted shade that keeps climbing past it. A drift here is a drift in both
-- copies, and every honest endless run would be refused.
select rls_test.ok(
  public.color_merge_rules_version() = 'color-merge@2'
  and public.color_merge_slides() = 48
  and public.color_merge_max_slides() = 4096,
  'the endless rules: no deck, a 4096-slide submission bound, and the legacy 48 kept for color-merge@1'
);
select rls_test.ok(
  public.color_merge_spawn_percent(1) = 10
  and public.color_merge_spawn_percent(4) = 10
  and public.color_merge_spawn_percent(5) = 11
  and public.color_merge_spawn_percent(50) = 20
  and public.color_merge_spawn_percent(250) = 60
  and public.color_merge_spawn_percent(100000) = 60,
  'the Color Merge spawn chance rises one point per five spawns and stops at 60%'
);
select rls_test.ok(
  public.color_merge_spawn_shade(1) = 2
  and public.color_merge_spawn_shade(119) = 2
  and public.color_merge_spawn_shade(120) = 3
  and public.color_merge_spawn_shade(240) = 4
  and public.color_merge_spawn_shade(120000) = 1002,
  'the Color Merge promoted shade climbs every 120 spawns, without cap'
);
select rls_test.ok(
  public.color_merge_board_endless(1) = array[0,0,0,0,0,0,0,0,0,0,0,0,1,1,0,0]::integer[],
  'the endless generator opens seed 1 on the board the client engine computes'
);
select rls_test.ok(
  public.color_merge_board_endless(9223372036854775807) = array[0,0,1,0,0,0,0,0,1,0,0,0,0,0,0,0]::integer[],
  'the endless generator deals a full-width seed with its own shade rule'
);
select rls_test.ok(
  public.color_merge_spawn_endless(1, 3, public.color_merge_board_endless(1))
    = array[0,0,1,0,0,0,0,0,0,0,0,0,1,1,0,0]::integer[],
  'the endless generator deals one tile per spawn, into an empty cell'
);
select rls_test.ok(
  public.color_merge_spawn_endless(1, 3, array[1,2,1,2,2,1,2,1,1,2,1,2,2,1,2,1]::integer[])
    = array[1,2,1,2,2,1,2,1,1,2,1,2,2,1,2,1]::integer[],
  'a spawn on a full board changes nothing'
);
select rls_test.raises(
  $$select public.color_merge_spawn_endless(1, 0, public.color_merge_board_endless(1))$$,
  '22023', 'a spawn index starts at one'
);
select rls_test.raises(
  $$select public.color_merge_spawn_percent(0)$$,
  '22023', 'a spawn before the first has no promotion chance'
);
-- The Stack 10 generator and its pressure ramp, asserted directly. The first
-- sixty tiles are the retired deck; from tile sixty-one a draw can arrive
-- promoted, heavier by a chance and a weight that both climb. A drift here is a
-- drift in both copies, and every honest endless run would be refused.
select rls_test.ok(
  public.stack10_rules_version() = 'stack-10@2'
  and public.stack10_tiles() = 60
  and public.stack10_max_tiles() = 4096,
  'the endless rules: no deck, a 4096-tile submission bound, and the legacy 60 kept for stack-10@1'
);
select rls_test.ok(
  public.stack10_pressure_percent(59) = 0
  and public.stack10_pressure_percent(60) = 0
  and public.stack10_pressure_percent(63) = 0
  and public.stack10_pressure_percent(64) = 1
  and public.stack10_pressure_percent(100) = 10
  and public.stack10_pressure_percent(200) = 35
  and public.stack10_pressure_percent(240) = 45
  and public.stack10_pressure_percent(300) = 60
  and public.stack10_pressure_percent(100000) = 60,
  'the Stack 10 pressure chance starts after the retired deck and stops at 60%'
);
select rls_test.ok(
  public.stack10_heavy_bonus(0) = 1
  and public.stack10_heavy_bonus(239) = 1
  and public.stack10_heavy_bonus(240) = 2
  and public.stack10_heavy_bonus(480) = 3
  and public.stack10_heavy_bonus(1920) = 9
  and public.stack10_heavy_bonus(100000) = 417,
  'the Stack 10 promoted weight climbs every 240 tiles, without cap'
);
select rls_test.ok(
  (select array_agg(public.stack10_tile(1, placed) order by placed)
     from generate_series(0, 13) as placed)
    = array[1,7,9,2,2,5,4,6,7,8,3,4,3,5]::integer[],
  'the generator deals seed 1''s retired deck before the ramp'
);
select rls_test.ok(
  public.stack10_tile(1, 60) = 9
  and public.stack10_tile(1, 64) = 4
  and public.stack10_tile(1, 100) = 4
  and public.stack10_tile(1, 240) = 9
  and public.stack10_tile(1, 300) = 1
  and public.stack10_tile(1, 480) = 9,
  'the generator draws the ramped tiles the client engine computes'
);
select rls_test.ok(
  (select array_agg(public.stack10_tile(9223372036854775807, placed) order by placed)
     from generate_series(0, 7) as placed)
    = array[6,2,9,4,5,3,6,1]::integer[],
  'the generator replays a full-width seed exactly'
);
select rls_test.raises(
  $$select public.stack10_tile(1, -1)$$,
  '22023', 'a tile index is zero or more'
);
-- The Don't Touch the Black generator, asserted directly: the whole sixty-cell
-- deck is the one the client engine computes and the verifier replays. A drift
-- here is a drift in both copies, and every honest run would be refused.
select rls_test.ok(
  public.dont_touch_rules_version() = 'dont-touch@2'
  and public.dont_touch_rows() = 20
  and public.dont_touch_lanes() = 3
  and public.dont_touch_cells() = 60
  and public.dont_touch_max_rows() = 1365
  and public.dont_touch_max_cells() = 4095
  and public.dont_touch_tile_score() = 10,
  'the endless rules: three lanes, a legacy sixty-cell deck, and a 4095-cell submission bound'
);
select rls_test.ok(
  public.dont_touch_black_percent(0) = 25
  and public.dont_touch_black_percent(9) = 25
  and public.dont_touch_black_percent(10) = 26
  and public.dont_touch_black_percent(199) = 44
  and public.dont_touch_black_percent(200) = 45
  and public.dont_touch_black_percent(1364) = 45,
  'the density ramp adds a black point every ten rows and stops at 45%'
);
select rls_test.raises(
  $$select public.dont_touch_black_percent(1365)$$,
  '22023', 'a row past the conveyor has no density'
);
select rls_test.ok(
  (select string_agg(case when public.dont_touch_black(1, cell) then 'B' else '.' end, '' order by cell)
     from generate_series(0, public.dont_touch_cells() - 1) as cell)
  = 'BB..BB..B..B...B..........B.B......B........B.BBBBB..B..B.B.',
  'the generator colours seed 1''s sixty cells'
);
select rls_test.ok(
  (select string_agg(case when public.dont_touch_black(9223372036854775807, cell) then 'B' else '.' end, '' order by cell)
     from generate_series(0, public.dont_touch_cells() - 1) as cell)
  = '.....B.B....BB.BB.......B..B..B..B................B......BB.',
  'the generator colours a full-width seed exactly'
);
select rls_test.ok(
  public.dont_touch_black(1, 0) and public.dont_touch_black(1, 15)
  and not public.dont_touch_black(1, 2) and not public.dont_touch_black(1, 59),
  'a cell is the colour the deck says, black and white both'
);
select rls_test.raises(
  $$select public.dont_touch_black(1, 60)$$,
  '22023', 'a sixty-first cell is not on the legacy deck'
);
select rls_test.ok(
  (select array_agg(
            (select string_agg(case when public.dont_touch_black_endless(1, cell) then 'B' else '.' end, '' order by cell)
               from generate_series(row * public.dont_touch_lanes(), row * public.dont_touch_lanes() + public.dont_touch_lanes() - 1) as cell)
          order by row)
     from generate_series(0, 11) as row)
  = array['.B.', '.BB', '...', '.B.', 'B.B', '.BB', '...', '.B.', 'B.B', '..B', '.B.', '..B']::text[],
  'the endless generator colours seed 1''s opening twelve rows'
);
select rls_test.ok(
  public.dont_touch_black_endless(1, 1)
  and not public.dont_touch_black_endless(1, 0)
  and public.dont_touch_black_endless(0, 41)
  and not public.dont_touch_black(0, 41),
  'the endless colour reads its row''s density, where the legacy colour is a flat 25%'
);
select rls_test.raises(
  $$select public.dont_touch_black_endless(1, 4095)$$,
  '22023', 'a cell past the endless conveyor is not addressable'
);
-- 7 Second's daily deck, asserted directly: the right button at a position is
-- the one the client engine draws and the verifier replays. The seed function is
-- the day itself, so the assertion is against the UTC date rather than a value
-- that would only be true today by accident.
select rls_test.ok(
  public.seven_second_rules_version() = 'seven-second@1'
  and public.seven_second_options() = 3
  and public.seven_second_answers() = 60,
  'a 7 Second run is three buttons and at most sixty answers'
);
select rls_test.ok(
  (select array_agg(public.seven_second_correct(1, index) order by index)
     from generate_series(0, 3) as index) = array[0,0,2,1]::integer[],
  'the generator draws seed 1''s first four right buttons'
);
select rls_test.ok(
  (select array_agg(public.seven_second_correct(2654435769, index) order by index)
     from generate_series(0, 5) as index) = array[1,0,0,2,1,2]::integer[],
  'the generator draws the zero-state fallback''s first six right buttons'
);
select rls_test.ok(
  public.seven_second_seed()
    = ((extract(epoch from (now() at time zone 'utc')::date)::bigint / 86400) * 2654435761 + 7),
  'the daily seed is the UTC date, hashed'
);
select rls_test.ok(
  public.seven_second_correct(9223372036854775807, 0)
    between 0 and public.seven_second_options() - 1,
  'a full-width seed still names a button that exists'
);
select rls_test.raises(
  $$select public.seven_second_correct(1, 60)$$,
  '22023', 'a sixty-first challenge is not on the deck'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

select rls_test.denied(
  $$insert into public.game_sessions (game_id, user_id) values ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', null)$$,
  'a client cannot insert a session: the server issues it with the seed'
);
select rls_test.denied(
  $$insert into public.scores (session_id, game_id, user_id, score)
    values ('cccccccc-4444-4444-8444-cccccccccccc', 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', null, 1)$$,
  'a client cannot write a score row'
);
select rls_test.denied(
  $$update public.game_sessions set completed_at = now() where id = 'cccccccc-4444-4444-8444-cccccccccccc'$$,
  'a client cannot close its own session'
);
select rls_test.denied(
  $$select id from public.game_sessions$$,
  'anonymous callers cannot read session rows at all'
);

-- The aggregate is public; the row-level table it is built from is not, and the
-- internal uuid is not part of the aggregate a caller may read.
select rls_test.allow($$select slug, plays from public.game_stats$$,
  'anon reads published aggregate activity');
select rls_test.denied($$select game_id from public.game_stats$$,
  'the internal game id is not granted on the public aggregate');
select rls_test.visible($$select * from public.game_leaderboard('fixture-secret', null, 10, 0)$$, 0,
  'an unpublished game has no public board');
select rls_test.visible($$select * from public.game_leaderboard('fixture-runnable', null, 10, 0)$$, 0,
  'a playable game with no recorded score has an empty board');

-- Starting a run: only a published, playable game, and only with the rules the
-- database can verify.
select rls_test.says(
  $$public.start_game_session('fixture-secret', 'stack-10@1', 'test')$$,
  'not_playable', 'an unpublished game cannot start a run'
);
select rls_test.says(
  $$public.start_game_session('fixture-stack', 'stack-10@1', 'test')$$,
  'not_playable', 'a published game with no runtime cannot start a run'
);
select rls_test.says(
  $$public.start_game_session('no-such-game-anywhere', 'stack-10@1', 'test')$$,
  'not_playable', 'an unknown slug is refused exactly like an unpublished one'
);
select rls_test.raises(
  $$select public.start_game_session('Not A Slug', 'stack-10@1', 'test')$$,
  '22023', 'a malformed slug is a request error, not a catalogue lookup'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@2', 'test')$$,
  'started', 'an endless Stack 10 run can be started'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@3', 'test')$$,
  'unsupported_runtime', 'rules the verifier does not implement are refused at the door'
);
-- The shipped game itself, not a fixture: after every migration has been applied,
-- the catalogue's own Stack 10 record is playable, carries its runtime, and can
-- issue a run to a guest. This is the production shape, asserted in the same suite
-- that runs the migration.
select rls_test.visible(
  $$select 1 from public.games where slug = 'stack-10' and playable and runtime = 'stack-10'$$,
  1, 'the shipped Stack 10 game is playable and names its runtime'
);
-- `fixture-%` are this suite's own playable games (the ones the refusal paths
-- need), so the claim is about the catalogue: of the games this repository
-- ships, only the six with runtimes are playable.
select rls_test.visible(
  $$select 1 from public.games
     where slug not in ('stack-10', 'dont-break-the-chain', 'memory-flash', 'one-move', 'color-merge', 'dont-touch-the-black', '7-second', 'crowns', 'trail', '8-puzzle', 'sun-and-moon') and slug not like 'fixture-%' and (playable or runtime is not null)$$,
  0, 'no shipped game besides the eleven runtimes is marked playable'
);
select rls_test.says_field(
  $$public.start_game_session('stack-10', 'stack-10@1', 'test/1.0')$$,
  'game_slug', 'stack-10', 'the shipped game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('stack-10', 'stack-10@2', 'test/1.0')$$,
  'rules_version', 'stack-10@2', 'the shipped Stack 10 game issues the endless rules'
);
select rls_test.says_field(
  $$public.start_game_session('stack-10', 'stack-10@2', 'test/1.0')$$,
  'tile_count', '4096', 'an endless Stack 10 session reports the submission bound, not a final tile'
);
select rls_test.says_field(
  $$public.start_game_session('stack-10', 'stack-10@1', 'test/1.0')$$,
  'tile_count', '60', 'a legacy Stack 10 session still counts its sixty tiles'
);
-- The shipped Chain game, same shape: playable, naming its runtime, issuing a
-- run whose move count is taps rather than tiles.
select rls_test.visible(
  $$select 1 from public.games where slug = 'dont-break-the-chain' and playable and runtime = 'chain'$$,
  1, 'the shipped Chain game is playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('dont-break-the-chain', 'chain@1', 'test/1.0')$$,
  'game_slug', 'dont-break-the-chain', 'the shipped Chain game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('dont-break-the-chain', 'chain@1', 'test/1.0')$$,
  'tile_count', '55', 'a legacy Chain session counts the taps of a perfect run'
);
-- Chain also accepts the endless version, and reports the submission bound
-- instead of a complete-run length: an endless run has no complete length.
select rls_test.says(
  $$public.start_game_session('dont-break-the-chain', 'chain@2', 'test/1.0')$$,
  'started', 'the shipped Chain game starts an endless run'
);
select rls_test.says_field(
  $$public.start_game_session('dont-break-the-chain', 'chain@2', 'test/1.0')$$,
  'tile_count', '4096', 'an endless Chain session reports the submission bound, not a final round'
);
select rls_test.says(
  $$public.start_game_session('fixture-chain', 'chain@2', 'test/1.0')$$,
  'started', 'a guest can start an endless Chain run'
);
-- The session clock is long enough for a marathon: twelve hours, not two.
select rls_test.ok(
  (select expires_at - started_at between interval '11 hours 59 minutes' and interval '12 hours 1 minute'
     from public.start_game_session('dont-break-the-chain', 'chain@2', 'test/1.0')),
  'an endless Chain session lives twelve hours so the clock does not end a run'
);
-- The shipped Memory Flash game, same shape: playable, naming its runtime,
-- issuing a run whose move count is the taps of a perfect run.
select rls_test.visible(
  $$select 1 from public.games where slug = 'memory-flash' and playable and runtime = 'memory-flash'$$,
  1, 'the shipped Memory Flash game is playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('memory-flash', 'memory-flash@1', 'test/1.0')$$,
  'game_slug', 'memory-flash', 'the shipped Memory Flash game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('memory-flash', 'memory-flash@1', 'test/1.0')$$,
  'tile_count', '55', 'a Memory Flash session counts the taps of a perfect run'
);
-- Memory Flash also accepts the endless version, and reports the submission bound
-- instead of a complete-run length: an endless run has no complete length.
select rls_test.says(
  $$public.start_game_session('memory-flash', 'memory-flash@2', 'test/1.0')$$,
  'started', 'the shipped Memory Flash game starts an endless run'
);
select rls_test.says_field(
  $$public.start_game_session('memory-flash', 'memory-flash@2', 'test/1.0')$$,
  'tile_count', '4096', 'an endless Memory Flash session reports the submission bound, not a final round'
);
select rls_test.says(
  $$public.start_game_session('fixture-memory', 'memory-flash@2', 'test/1.0')$$,
  'started', 'a guest can start an endless Memory Flash run'
);
-- The session clock is long enough for a marathon: twelve hours, not two.
select rls_test.ok(
  (select expires_at - started_at between interval '11 hours 59 minutes' and interval '12 hours 1 minute'
     from public.start_game_session('memory-flash', 'memory-flash@2', 'test/1.0')),
  'an endless Memory Flash session lives twelve hours so the clock does not end a run'
);
-- A version no verifier implements is still refused, endless game or not.
select rls_test.says(
  $$public.start_game_session('memory-flash', 'memory-flash@3', 'test/1.0')$$,
  'unsupported_runtime', 'a Memory Flash rules version nothing implements is refused at the gate'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'started', 'a guest can start a run'
);
select rls_test.says_field(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'tile_count', '60', 'the server tells the client how long the run is'
);
-- The gate is a pair: a Stack 10 game with Chain rules, and a Chain game with
-- Stack 10 rules, are both versions no verifier owns.
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'chain@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a Chain run'
);
select rls_test.says(
  $$public.start_game_session('fixture-chain', 'stack-10@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Chain game cannot start a Stack 10 run'
);
select rls_test.says(
  $$public.start_game_session('fixture-chain', 'chain@1', 'test/1.0')$$,
  'started', 'a guest can start a Chain run'
);
-- The gate knows the third pair too, and refuses a game paired with another
-- game's rules.
select rls_test.says(
  $$public.start_game_session('fixture-memory', 'memory-flash@1', 'test/1.0')$$,
  'started', 'a guest can start a Memory Flash run'
);
select rls_test.says(
  $$public.start_game_session('fixture-memory', 'stack-10@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Memory Flash game cannot start a Stack 10 run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'memory-flash@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a Memory Flash run'
);
-- The shipped One Move game, same shape: playable, naming its runtime, issuing a
-- run whose move count is one tap per board.
select rls_test.visible(
  $$select 1 from public.games where slug = 'one-move' and playable and runtime = 'one-move'$$,
  1, 'the shipped One Move game is playable and names its runtime'
);
-- The shipped Queens game, named Crowns: playable, naming its runtime, issuing a
-- twelve-hour run that reports its submission bound.
select rls_test.visible(
  $$select 1 from public.games where slug = 'crowns' and title = 'Crowns' and playable
       and runtime = 'queens' and status = 'published' and is_official$$,
  1, 'the shipped Crowns game is published, playable and names the queens runtime'
);
select rls_test.visible(
  $$select 1 from public.games where slug in ('queens', 'zip', 'tango')$$,
  0, 'no game keeps the old Queens, Zip or Tango slugs'
);
select rls_test.says_field(
  $$public.start_game_session('crowns', 'queens@1', 'test/1.0')$$,
  'game_slug', 'crowns', 'the shipped Crowns game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('crowns', 'queens@1', 'test/1.0')$$,
  'tile_count', '8192', 'a Queens session reports its submission bound'
);
select rls_test.ok(
  (select r.expires_at - r.started_at = interval '12 hours'
     from public.start_game_session('fixture-queens', 'queens@1', 'test/1.0') r),
  'a Queens session lives twelve hours, like every endless run'
);
select rls_test.says(
  $$public.start_game_session('fixture-queens', 'one-move@2', 'test/1.0')$$,
  'unsupported_runtime', 'a Queens game cannot start a One Move run'
);
select rls_test.says(
  $$public.start_game_session('fixture-queens', 'queens@2', 'test/1.0')$$,
  'unsupported_runtime', 'Queens rules the verifier does not implement are refused at the door'
);
select rls_test.says(
  $$public.start_game_session('fixture-one-move', 'queens@1', 'test/1.0')$$,
  'unsupported_runtime', 'a One Move game cannot start a Queens run'
);
-- The shipped Zip game, named Trail, same shape.
select rls_test.visible(
  $$select 1 from public.games where slug = 'trail' and title = 'Trail' and playable
       and runtime = 'zip' and status = 'published' and is_official$$,
  1, 'the shipped Trail game is published, playable and names the zip runtime'
);
select rls_test.says_field(
  $$public.start_game_session('trail', 'zip@1', 'test/1.0')$$,
  'tile_count', '8192', 'a Zip session reports its submission bound'
);
select rls_test.says(
  $$public.start_game_session('fixture-zip', 'queens@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Zip game cannot start a Queens run'
);
select rls_test.says(
  $$public.start_game_session('fixture-queens', 'zip@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Queens game cannot start a Zip run'
);
-- The shipped 8 Puzzle game, same shape.
select rls_test.visible(
  $$select 1 from public.games where slug = '8-puzzle' and playable and runtime = 'eight-puzzle'
       and status = 'published' and is_official$$,
  1, 'the shipped 8 Puzzle game is published, playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('8-puzzle', 'eight-puzzle@1', 'test/1.0')$$,
  'tile_count', '8192', 'an 8 Puzzle session reports its submission bound'
);
select rls_test.says(
  $$public.start_game_session('fixture-eight-puzzle', 'zip@1', 'test/1.0')$$,
  'unsupported_runtime', 'an 8 Puzzle game cannot start a Zip run'
);
select rls_test.says(
  $$public.start_game_session('fixture-zip', 'eight-puzzle@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Zip game cannot start an 8 Puzzle run'
);
-- The shipped Tango game, named Sun & Moon, same shape.
select rls_test.visible(
  $$select 1 from public.games where slug = 'sun-and-moon' and title = 'Sun & Moon' and playable
       and runtime = 'tango' and status = 'published' and is_official$$,
  1, 'the shipped Sun & Moon game is published, playable and names the tango runtime'
);
select rls_test.says_field(
  $$public.start_game_session('sun-and-moon', 'tango@1', 'test/1.0')$$,
  'tile_count', '8192', 'a Tango session reports its submission bound'
);
select rls_test.says(
  $$public.start_game_session('fixture-tango', 'queens@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Tango game cannot start a Queens run'
);
select rls_test.says(
  $$public.start_game_session('fixture-queens', 'tango@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Queens game cannot start a Tango run'
);
select rls_test.says_field(
  $$public.start_game_session('one-move', 'one-move@1', 'test/1.0')$$,
  'game_slug', 'one-move', 'the shipped One Move game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('one-move', 'one-move@1', 'test/1.0')$$,
  'tile_count', '12', 'a One Move session counts one tap per board'
);
-- The gate knows the fourth pair too, and refuses a game paired with another
-- game's rules.
select rls_test.says(
  $$public.start_game_session('fixture-one-move', 'one-move@1', 'test/1.0')$$,
  'started', 'a guest can start a One Move run'
);
select rls_test.says(
  $$public.start_game_session('fixture-one-move', 'memory-flash@1', 'test/1.0')$$,
  'unsupported_runtime', 'a One Move game cannot start a Memory Flash run'
);
select rls_test.says(
  $$public.start_game_session('fixture-memory', 'one-move@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Memory Flash game cannot start a One Move run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'one-move@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a One Move run'
);
select rls_test.says_field(
  $$public.start_game_session('one-move', 'one-move@2', 'test/1.0')$$,
  'rules_version', 'one-move@2', 'the shipped One Move game issues the endless rules'
);
select rls_test.says_field(
  $$public.start_game_session('one-move', 'one-move@2', 'test/1.0')$$,
  'tile_count', '4096', 'an endless One Move session reports the submission bound, not a final board'
);
-- The session clock is long enough for a marathon: twelve hours, not two.
select rls_test.ok(
  (select expires_at - started_at between interval '11 hours 59 minutes' and interval '12 hours 1 minute'
     from public.start_game_session('one-move', 'one-move@2', 'test/1.0')),
  'an endless One Move session lives twelve hours so the clock does not end a run'
);
-- The shipped Color Merge game, same shape: playable, naming its runtime,
-- issuing a run whose move count is the deck's slides.
select rls_test.visible(
  $$select 1 from public.games where slug = 'color-merge' and playable and runtime = 'color-merge'$$,
  1, 'the shipped Color Merge game is playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('color-merge', 'color-merge@1', 'test/1.0')$$,
  'game_slug', 'color-merge', 'the shipped Color Merge game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('color-merge', 'color-merge@1', 'test/1.0')$$,
  'tile_count', '48', 'a legacy Color Merge session still counts its forty-eight slides'
);
select rls_test.says_field(
  $$public.start_game_session('color-merge', 'color-merge@2', 'test/1.0')$$,
  'rules_version', 'color-merge@2', 'the shipped Color Merge game issues the endless rules'
);
select rls_test.says_field(
  $$public.start_game_session('color-merge', 'color-merge@2', 'test/1.0')$$,
  'tile_count', '4096', 'an endless Color Merge session reports the submission bound, not a final slide'
);
-- The gate knows the fifth pair too, and refuses a game paired with another
-- game's rules.
select rls_test.says(
  $$public.start_game_session('fixture-color-merge', 'color-merge@1', 'test/1.0')$$,
  'started', 'a guest can start a Color Merge run'
);
select rls_test.says(
  $$public.start_game_session('fixture-color-merge', 'color-merge@2', 'test/1.0')$$,
  'started', 'a guest can start an endless Color Merge run'
);
select rls_test.says(
  $$public.start_game_session('fixture-color-merge', 'color-merge@3', 'test/1.0')$$,
  'unsupported_runtime', 'a Color Merge rules version no verifier owns is refused'
);
select rls_test.says(
  $$public.start_game_session('fixture-color-merge', 'one-move@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Color Merge game cannot start a One Move run'
);
select rls_test.says(
  $$public.start_game_session('fixture-one-move', 'color-merge@1', 'test/1.0')$$,
  'unsupported_runtime', 'a One Move game cannot start a Color Merge run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'color-merge@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a Color Merge run'
);
-- The shipped Don't Touch the Black game, same shape: playable, naming its
-- runtime, issuing a run whose move count is the deck's cells.
select rls_test.visible(
  $$select 1 from public.games where slug = 'dont-touch-the-black' and playable and runtime = 'dont-touch'$$,
  1, 'the shipped Don''t Touch the Black game is playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('dont-touch-the-black', 'dont-touch@1', 'test/1.0')$$,
  'game_slug', 'dont-touch-the-black', 'the shipped Don''t Touch the Black game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('dont-touch-the-black', 'dont-touch@2', 'test/1.0')$$,
  'tile_count', '4095', 'an endless Don''t Touch the Black session reports the submission bound, not a final row'
);
-- A legacy session can still be started: a client deployed before the endless
-- release keeps its exact rules and its sixty-cell count.
select rls_test.says_field(
  $$public.start_game_session('dont-touch-the-black', 'dont-touch@1', 'test/1.0')$$,
  'tile_count', '60', 'a legacy Don''t Touch the Black session still counts its sixty cells'
);
-- The gate knows the sixth pair too, and refuses a game paired with another
-- game's rules.
select rls_test.says(
  $$public.start_game_session('fixture-dont-touch', 'dont-touch@1', 'test/1.0')$$,
  'started', 'a guest can start a legacy Don''t Touch the Black run'
);
select rls_test.says(
  $$public.start_game_session('fixture-dont-touch', 'dont-touch@2', 'test/1.0')$$,
  'started', 'a guest can start an endless Don''t Touch the Black run'
);
select rls_test.says(
  $$public.start_game_session('fixture-dont-touch', 'color-merge@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Don''t Touch the Black game cannot start a Color Merge run'
);
select rls_test.says(
  $$public.start_game_session('fixture-color-merge', 'dont-touch@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Color Merge game cannot start a Don''t Touch the Black run'
);
select rls_test.says(
  $$public.start_game_session('fixture-color-merge', 'dont-touch@2', 'test/1.0')$$,
  'unsupported_runtime', 'a Color Merge game cannot start an endless Don''t Touch the Black run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'dont-touch@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a Don''t Touch the Black run'
);
-- The shipped 7 Second game, same shape: playable, naming its runtime, issuing
-- a daily run whose move count is the answer cap.
select rls_test.visible(
  $$select 1 from public.games where slug = '7-second' and playable and runtime = 'seven-second'$$,
  1, 'the shipped 7 Second game is playable and names its runtime'
);
select rls_test.says_field(
  $$public.start_game_session('7-second', 'seven-second@1', 'test/1.0')$$,
  'game_slug', '7-second', 'the shipped 7 Second game issues a run like any other'
);
select rls_test.says_field(
  $$public.start_game_session('7-second', 'seven-second@1', 'test/1.0')$$,
  'tile_count', '60', 'a 7 Second session counts the answers a run can hold'
);
select rls_test.says(
  $$public.start_game_session('7-second', 'dont-touch@1', 'test/1.0')$$,
  'unsupported_runtime', 'the shipped 7 Second game cannot start a Don''t Touch the Black run'
);
-- The gate knows the seventh pair too, and refuses a game paired with another
-- game's rules.
select rls_test.says(
  $$public.start_game_session('fixture-seven-second', 'seven-second@1', 'test/1.0')$$,
  'started', 'a guest can start a 7 Second run, daily limit or not'
);
select rls_test.says(
  $$public.start_game_session('fixture-seven-second', 'dont-touch@1', 'test/1.0')$$,
  'unsupported_runtime', 'a 7 Second game cannot start a Don''t Touch the Black run'
);
select rls_test.says(
  $$public.start_game_session('fixture-dont-touch', 'seven-second@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Don''t Touch the Black game cannot start a 7 Second run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'seven-second@1', 'test/1.0')$$,
  'unsupported_runtime', 'a Stack 10 game cannot start a 7 Second run'
);

-- A guest run completes and is verified, and stays unranked: there is no score
-- row for it, because `scores.user_id` is NOT NULL by design.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'recorded', 'a guest run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'duplicate', 'a repeated submission of the same run is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'ranked', 'false', 'a guest run is never ranked'
);
-- A guest endless run takes the same path: verified, recorded on its session,
-- and never ranked, because a guest has no score to set.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-9999-4999-8999-cccccccccccc'::uuid, %s, 435, 45000)$$, :'stack10_endless'),
  'recorded', 'a guest endless Stack 10 run is replayed and recorded'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-9999-4999-8999-cccccccccccc'::uuid, %s, 435, 45000)$$, :'stack10_endless'),
  'ranked', 'false', 'a guest endless Stack 10 run is never ranked'
);
-- A guest Chain run completes the same way: verified, recorded, unranked.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-4444-4444-8444-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'recorded', 'a guest Chain run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-4444-4444-8444-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'duplicate', 'a repeated guest Chain submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-4444-4444-8444-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'ranked', 'false', 'a guest Chain run is never ranked'
);
-- A guest Memory Flash run completes the same way: verified, recorded, unranked.
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-4444-4444-8444-eeeeeeeeeeee'::uuid, %s, 100, 45000)$$, :'memory_perfect'),
  'recorded', 'a guest Memory Flash run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-4444-4444-8444-eeeeeeeeeeee'::uuid, %s, 100, 45000)$$, :'memory_perfect'),
  'duplicate', 'a repeated guest Memory Flash submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_memory_flash_run('eeeeeeee-4444-4444-8444-eeeeeeeeeeee'::uuid, %s, 100, 45000)$$, :'memory_perfect'),
  'ranked', 'false', 'a guest Memory Flash run is never ranked'
);
-- A guest's endless run is verified, closed and never ranked. It clears rounds one
-- to eight and then taps cell 24 — a cell the retired 4×4 board did not have, and
-- not one round nine lights — so the record proves the board really did grow, and
-- that a cell outside the pattern is still the ordinary way a run ends.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 80
      and r.cleared_columns = 8
      and r.tiles_placed = 37
     from public.complete_memory_flash_run(
       'eeeeeeee-7777-4777-8777-eeeeeeeeeeee'::uuid, :memory_eight_rounds || 24, 80, 45000) r),
  'a guest completes an endless run: eight patterns cleared on the retired board, then cell 24 on the grown one'
);
select rls_test.says_field(
  format($$public.complete_memory_flash_run('eeeeeeee-7777-4777-8777-eeeeeeeeeeee'::uuid, %s || 24, 80, 45000)$$, :'memory_eight_rounds'),
  'ranked', 'false', 'a guest''s endless run is not ranked'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'eeeeeeee-7777-4777-8777-eeeeeeeeeeee'$$) = 0,
  'a guest''s endless run leaves no score behind'
);
-- A guest One Move run completes the same way: verified, recorded, unranked.
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-4444-4444-8444-ffffffffffff'::uuid, %s, 120, 45000)$$, :'one_move_perfect'),
  'recorded', 'a guest One Move run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-4444-4444-8444-ffffffffffff'::uuid, %s, 120, 45000)$$, :'one_move_perfect'),
  'duplicate', 'a repeated guest One Move submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_one_move_run('ffffffff-4444-4444-8444-ffffffffffff'::uuid, %s, 120, 45000)$$, :'one_move_perfect'),
  'ranked', 'false', 'a guest One Move run is never ranked'
);
-- A guest's endless run is verified and closed the same way, and its twentieth
-- board is one the retired twelve-board game never dealt.
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-7777-4777-8777-ffffffffffff'::uuid, %s, 200, 45000)$$, :'one_move_endless'),
  'recorded', 'a guest completes an endless One Move run past the retired twelfth board'
);
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-7777-4777-8777-ffffffffffff'::uuid, %s, 200, 45000)$$, :'one_move_endless'),
  'duplicate', 'a repeated guest endless One Move submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_one_move_run('ffffffff-7777-4777-8777-ffffffffffff'::uuid, %s, 200, 45000)$$, :'one_move_endless'),
  'ranked', 'false', 'a guest''s endless One Move run is not ranked'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'ffffffff-7777-4777-8777-ffffffffffff'$$) = 0,
  'a guest''s endless One Move run leaves no score behind'
);
-- A guest Color Merge run completes the same way: verified, recorded, unranked.
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-4444-4444-8444-999999999999'::uuid, %s, 272, 45000)$$, :'color_merge_deck'),
  'recorded', 'a guest Color Merge run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-4444-4444-8444-999999999999'::uuid, %s, 272, 45000)$$, :'color_merge_deck'),
  'duplicate', 'a repeated guest Color Merge submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_color_merge_run('99999999-4444-4444-8444-999999999999'::uuid, %s, 272, 45000)$$, :'color_merge_deck'),
  'ranked', 'false', 'a guest Color Merge run is never ranked'
);
-- The endless guest run takes the same path: verified, recorded on its session,
-- and never ranked, because a guest has no score to set.
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-8888-4888-8888-999999999999'::uuid, %s, 468, 45000)$$, :'color_merge_endless_one'),
  'recorded', 'a guest endless Color Merge run is replayed and recorded'
);
select rls_test.says_field(
  format($$public.complete_color_merge_run('99999999-8888-4888-8888-999999999999'::uuid, %s, 468, 45000)$$, :'color_merge_endless_one'),
  'ranked', 'false', 'a guest endless Color Merge run is never ranked'
);
-- A guest Don't Touch the Black run completes the same way: verified, recorded,
-- unranked.
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-4444-4444-8444-777777777777'::uuid, %s, 410, 45000)$$, :'dont_touch_perfect'),
  'recorded', 'a guest Don''t Touch the Black run is replayed and recorded'
);
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-4444-4444-8444-777777777777'::uuid, %s, 410, 45000)$$, :'dont_touch_perfect'),
  'duplicate', 'a repeated guest Don''t Touch the Black submission is recognised, not recorded again'
);
select rls_test.says_field(
  format($$public.complete_dont_touch_run('77777777-4444-4444-8444-777777777777'::uuid, %s, 410, 45000)$$, :'dont_touch_perfect'),
  'ranked', 'false', 'a guest Don''t Touch the Black run is never ranked'
);
-- A guest 7 Second run: the claimed score is checked against the replay, then
-- recorded unranked. Seed 1's line [0,1,2,1] clears three of four for thirty.
select rls_test.ok(
  (select r.outcome = 'score_mismatch' and r.score = 30
     from public.complete_seven_second_run(
       '88888888-4444-4444-8444-888888888888'::uuid, array[0,1,2,1], 40, 45000) r),
  'a 7 Second claim the replay contradicts is refused, and the real score comes back'
);
select rls_test.ok(
  (select r.outcome = 'invalid_actions'
     from public.complete_seven_second_run(
       '88888888-4444-4444-8444-888888888888'::uuid, array[3], 0, 45000) r),
  'a fourth button is not a 7 Second answer'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 30 and r.tiles_placed = 4 and not r.ranked
     from public.complete_seven_second_run(
       '88888888-4444-4444-8444-888888888888'::uuid, array[0,1,2,1], 30, 45000) r),
  'a guest 7 Second run is replayed and recorded at thirty, unranked'
);
select rls_test.says(
  $$public.complete_seven_second_run('88888888-4444-4444-8444-888888888888'::uuid, array[0,1,2,1], 30, 45000)$$,
  'duplicate', 'a repeated guest 7 Second submission is recognised, not recorded again'
);
-- A guest Queens run completes the same way: verified, recorded, unranked.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 50 and r.ranked = false
     from public.complete_queens_run(
       'c0c0c0c0-4444-4444-8444-c0c0c0c0c0c0'::uuid, :queens_line, 50, 45000) r),
  'a guest Queens run is replayed and recorded at fifty, unranked'
);
select rls_test.says(
  format($$public.complete_queens_run('c0c0c0c0-4444-4444-8444-c0c0c0c0c0c0'::uuid, %s, 50, 45000)$$, :'queens_line'),
  'duplicate', 'a repeated guest Queens submission is recognised, not recorded again'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'c0c0c0c0-4444-4444-8444-c0c0c0c0c0c0'$$) = 0,
  'a guest Queens run leaves no score behind'
);
-- A guest Zip run completes the same way: verified, recorded, unranked.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 50 and r.ranked = false
     from public.complete_zip_run(
       'd1d1d1d1-4444-4444-8444-d1d1d1d1d1d1'::uuid, :zip_line, 50, 25000) r),
  'a guest Zip run is replayed and recorded at fifty, unranked'
);
select rls_test.says(
  format($$public.complete_zip_run('d1d1d1d1-4444-4444-8444-d1d1d1d1d1d1'::uuid, %s, 50, 25000)$$, :'zip_line'),
  'duplicate', 'a repeated guest Zip submission is recognised, not recorded again'
);
-- A guest has no account to keep progress or stats on: the functions are not
-- theirs to call at all.
select rls_test.raises(
  $$select public.save_run_progress('f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'::uuid, array[1], 1000)$$,
  '42501', 'a guest cannot save a run'
);
select rls_test.raises(
  $$select * from public.saved_run('fixture-queens', 'queens@1')$$,
  '42501', 'a guest has no saved run to look up'
);
select rls_test.raises(
  $$select * from public.my_game_stats('fixture-queens')$$,
  '42501', 'a guest has no stats to read'
);
-- A guest 8 Puzzle run completes the same way: verified, recorded, unranked.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 10 and r.ranked = false
     from public.complete_eight_puzzle_run(
       'e2e2e2e2-4444-4444-8444-e2e2e2e2e2e2'::uuid, :eight_line, 10, 25000) r),
  'a guest 8 Puzzle run is replayed and recorded at ten, unranked'
);
-- A guest Tango run completes the same way: verified, recorded, unranked.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 60 and r.ranked = false
     from public.complete_tango_run(
       'a7a7a7a7-4444-4444-8444-a7a7a7a7a7a7'::uuid, :tango_line, 60, 25000) r),
  'a guest Tango run is replayed and recorded at sixty, unranked'
);

reset role;

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

select rls_test.denied(
  $$insert into public.game_sessions (game_id, user_id) values ('aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111')$$,
  'a signed-in player cannot insert a session either: the seed has to be the server''s'
);

-- The daily limit is a rule of the game, not of the screen: Alice already
-- finished a run of today's seed (the done fixture), so asking for another is
-- refused by name. The same request from a guest is *not* refused, because a
-- guest has no score to set — that is asserted in the anonymous section above.
select rls_test.says(
  $$public.start_game_session('fixture-seven-second', 'seven-second@1', 'test/1.0')$$,
  'already_played', 'a signed-in player gets one ranked 7 Second attempt a day'
);

-- Refusals: another player's session, a guest session, an expired one, an
-- abandoned one, and rules this database cannot verify.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-6666-4666-8666-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'not_found', 'another player''s session is not found, and not distinguished from missing'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-4444-4444-8444-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'not_found', 'a guest run cannot be claimed by a signed-in caller'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-2222-4222-8222-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'expired', 'a run cannot be completed after its session expired'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-3333-4333-8333-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'abandoned', 'a replaced run cannot be submitted'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-5555-4555-8555-cccccccccccc'::uuid, %s, 55, 1000)$$, :'greedy_run'),
  'wrong_rules', 'a session pinned to rules this verifier does not implement is refused'
);

-- Refusals: a run the rules cannot have produced. Each one leaves the session
-- open, so the same fixture can be used for the next attempt.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 999999999)$$, :'greedy_run'),
  'invalid_duration', 'a claim that the run took longer than the session has existed is impossible'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[0,0,1,0,0,0,2,2,2,3], 55, 45000)$$,
  'invalid_actions', 'a partial run is not a finished run: the ending move cannot be dropped'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[0,0,4], 55, 45000)$$,
  'invalid_actions', 'a column that does not exist is impossible play'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s || 0, 55, 45000)$$, :'greedy_run'),
  'invalid_actions', 'play cannot continue after the run ended'
);
select rls_test.raises(
  $$select public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[null]::integer[], 55, 45000)$$,
  '22023', 'a ragged action list is a request error, not a scored run'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 999, 45000)$$, :'greedy_run'),
  'score_mismatch', 'a score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 999, 45000)$$, :'greedy_run'),
  'score', '55', 'the replay is the score, and it is reported back'
);

-- The real submission, then a retry of it.
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'recorded', 'a legal run is recorded'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'duplicate', 'a retry of the same submission is safe to repeat'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, %s, 55, 45000)$$, :'greedy_run'),
  'ranked', 'true', 'a signed-in run is ranked'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-1111-4111-8111-cccccccccccc'::uuid, array[0], 55, 45000)$$,
  'closed', 'a closed session does not accept a different run in place of the recorded one'
);
select rls_test.ok(
  (select verified_score = 55 from public.game_sessions where id = 'cccccccc-1111-4111-8111-cccccccccccc'),
  'a player can read the verified score on their own session'
);
select rls_test.ok(
  (select rank = 1 and score = 55 from public.game_standing('fixture-runnable', '11111111-1111-4111-8111-111111111111', null)),
  'your standing on the board is your recorded best at its real rank'
);
-- ── Endless Stack 10: past the retired deck, and only the board ends a run ──
--
-- Seed 1's retired perfect line is sixty tiles for 420; the endless rules keep
-- playing, and seven more tiles end it at sixty-seven for 435. The retired line
-- on its own no longer ends anything: it is a run the player stopped at sixty.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 435
      and r.tiles_placed = 67
      and r.cleared_columns = 26
     from public.complete_stack10_run(
       'cccccccc-7777-4777-8777-cccccccccccc'::uuid, :stack10_endless, 435, 45000) r),
  'an endless Stack 10 run is recorded: sixty-seven tiles, 435 points'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-7777-4777-8777-cccccccccccc'::uuid, %s, 435, 45000)$$, :'stack10_endless'),
  'duplicate', 'a retry of the same endless Stack 10 run is safe to repeat'
);
select rls_test.says(
  $$public.complete_stack10_run('cccccccc-7777-4777-8777-cccccccccccc'::uuid, array[0], 0, 45000)$$,
  'closed', 'a closed endless Stack 10 session does not accept a different run'
);
select rls_test.ok(
  (select rank = 1 and score = 435 from public.game_standing('fixture-stack-endless', '11111111-1111-4111-8111-111111111111', null)),
  'an endless Stack 10 score becomes the standing on its own board'
);
-- The retired perfect line, submitted to an endless session, stops at tile 60
-- with the board still able to take a tile: the player ended the run, and it is
-- scored as it stands (a wrong claim reports the score and keeps the session
-- open for the assertions below).
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-8888-4888-8888-cccccccccccc'::uuid, (%s)[1:60], 999999, 45000)$$, :'stack10_endless'),
  'score', '420', 'an endless Stack 10 run the player ends after sixty tiles is scored as it stands'
);
select rls_test.says_field(
  format($$public.complete_stack10_run('cccccccc-8888-4888-8888-cccccccccccc'::uuid, %s, 999, 45000)$$, :'stack10_endless'),
  'score', '435', 'the endless Stack 10 replay is the score, and it is reported back'
);
select rls_test.says(
  format($$public.complete_stack10_run('cccccccc-8888-4888-8888-cccccccccccc'::uuid, %s || 0, 435, 45000)$$, :'stack10_endless'),
  'invalid_actions', 'a tile after the endless board ended is impossible play'
);
-- The shortest run past the old deck: the retired line plus one tile, which
-- overflows. It is recorded where the sixty-tile line was refused.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 420 and r.tiles_placed = 61
     from public.complete_stack10_run(
       'cccccccc-8888-4888-8888-cccccccccccc'::uuid, :stack10_past_deck, 420, 45000) r),
  'a run one tile past the retired deck is recorded: sixty-one tiles, 420 points'
);

-- ── Chain: the same properties, replayed against a growing sequence ──
--
-- Seed 1 deals 0,0,2,3,0,0,2,2,0,1: round 1 is [0], round 2 [0,0], round 3
-- [0,0,2], and so on to ten rounds. The perfect line below is those 55 taps
-- for 55 points and ten cleared rounds; the loss line reproduces rounds one
-- and two and then breaks the chain for 3 points and two cleared rounds. The
-- expected numbers are arithmetic from the seed, not values read back.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'recorded', 'a perfect Chain run is recorded'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'score', '55', 'the replay counts every correct tap'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, %s, 55, 45000)$$, :'chain_perfect'),
  'duplicate', 'a retry of the same Chain run is safe to repeat'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-1111-4111-8111-dddddddddddd'::uuid, array[0], 55, 45000)$$,
  'closed', 'a closed Chain session does not accept a different run'
);
-- Refusals, all leaving the loss fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, %s, 999, 45000)$$, :'chain_perfect'),
  'score_mismatch', 'a Chain score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, %s, 999, 45000)$$, :'chain_perfect'),
  'score', '55', 'the Chain replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0], 3, 45000)$$,
  'invalid_actions', 'a Chain run that stops before the tenth round is cleared is partial'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0,1,0], 3, 45000)$$,
  'invalid_actions', 'taps after the tap that broke the chain are impossible play'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[4], 0, 45000)$$,
  'invalid_actions', 'a pad that does not exist is impossible play'
);
select rls_test.raises(
  $$select public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged Chain action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-5555-4555-8555-dddddddddddd'::uuid, array[0], 0, 45000)$$,
  'wrong_rules', 'a Chain session pinned to other rules is refused by its own verifier'
);
-- The loss is a recorded run, not a discarded one: three correct taps, two
-- cleared rounds, four taps placed including the tap that broke the chain.
select rls_test.says(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0,1], 3, 45000)$$,
  'recorded', 'a broken chain is recorded with the taps it earned'
);
select rls_test.says_field(
  $$public.complete_chain_run('dddddddd-2222-4222-8222-dddddddddddd'::uuid, array[0,0,0,1], 3, 45000)$$,
  'score', '3', 'a broken chain keeps only its correct taps'
);
select rls_test.ok(
  (select verified_score = 3 from public.game_sessions where id = 'dddddddd-2222-4222-8222-dddddddddddd'),
  'a player can read the verified score on their own Chain session'
);
select rls_test.ok(
  (select rank = 1 and score = 55 from public.game_standing('fixture-chain', '11111111-1111-4111-8111-111111111111', null)),
  'your Chain standing is your recorded best at its real rank'
);

-- ── Chain: the endless game, past the old tenth round ──
--
-- The same seed and the same rules, with no final round. The twelve-round line
-- is 78 correct taps and then a tap that breaks the chain: 78 points, twelve
-- rounds cleared, 79 taps submitted. If the verifier still stopped at ten, this
-- submission would be an impossible run rather than a recorded one.
-- The first call records; the field is only on a recorded result, so a still
-- ten-round verifier would fail here rather than quietly pass a duplicate.
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-3333-4333-8333-dddddddddddd'::uuid, %s, 78, 45000)$$, :'chain_endless_line'),
  'cleared_columns', '12', 'a run past the old tenth round records twelve cleared rounds'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-3333-4333-8333-dddddddddddd'::uuid, %s, 78, 45000)$$, :'chain_endless_line'),
  'score', '78', 'the endless replay counts all seventy-eight correct taps'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-3333-4333-8333-dddddddddddd'::uuid, %s, 78, 45000)$$, :'chain_endless_line'),
  'duplicate', 'a retry of the same endless run is safe to repeat'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-3333-4333-8333-dddddddddddd'::uuid, array[0], 78, 45000)$$,
  'closed', 'a closed endless session does not accept a different run'
);
select rls_test.ok(
  (select verified_score = 78 from public.game_sessions where id = 'dddddddd-3333-4333-8333-dddddddddddd'),
  'the endless run closes with its verified score on the session'
);
select rls_test.ok(
  (select rank = 1 and score = 78 from public.game_standing('fixture-chain-endless', :'alice'::uuid, null)),
  'a run past ten rounds ranks on the endless board at its real score'
);
-- Refusals, each leaving the open session open for the next attempt. A
-- submission that does not end with a loss is a run the player ended, and is
-- scored as it stands; the wrong claims below keep the session open.
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, %s, 999999, 45000)$$, :'chain_perfect'),
  'score', '55', 'an endless Chain run the player ends after ten rounds is scored as it stands'
);
select rls_test.says_field(
  $$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, array[0,0,0], 999999, 45000)$$,
  'score', '3', 'an endless Chain run the player ends mid-round is scored as it stands'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, %s || 0, 78, 45000)$$, :'chain_endless_line'),
  'invalid_actions', 'taps after the tap that broke an endless chain are impossible play'
);
select rls_test.says(
  $$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, array[4], 0, 45000)$$,
  'invalid_actions', 'a pad that does not exist is impossible play in the endless game too'
);
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, %s, 999, 45000)$$, :'chain_endless_line'),
  'score_mismatch', 'an endless score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, %s, 999, 45000)$$, :'chain_endless_line'),
  'score', '78', 'the endless replay is the score, and it is reported back'
);
-- And the same run, from the open session, is recorded exactly once.
select rls_test.says(
  format($$public.complete_chain_run('dddddddd-6666-4666-8666-dddddddddddd'::uuid, %s, 78, 45000)$$, :'chain_endless_line'),
  'recorded', 'an endless run is recorded after the refused attempts leave the session open'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'dddddddd-6666-4666-8666-dddddddddddd'$$) = 1,
  'an endless run leaves exactly one score for its session'
);

-- ── Memory Flash: the same properties, replayed against growing patterns ──
--
-- Seed 1 flashes [8], then [8,6], then [3,0,8], and so on to ten patterns. The
-- perfect line below rebuilds each pattern in draw order: 55 taps, ten cleared
-- patterns and 100 points. The broken line rebuilds round one, enters the first
-- cell of round two, then taps a cell round two does not light: 10 points.
--
-- The expected numbers are arithmetic from the seed, not values read back.
-- One call, every number it derives: outcome, score, cleared patterns and the
-- taps of the submitted run.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 100
      and r.cleared_columns = 10
      and r.tiles_placed = 55
     from public.complete_memory_flash_run(
       'eeeeeeee-1111-4111-8111-eeeeeeeeeeee'::uuid, :memory_perfect, 100, 45000) r),
  'a perfect Memory Flash run is recorded: ten patterns, fifty-five taps, 100 points'
);
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-1111-4111-8111-eeeeeeeeeeee'::uuid, %s, 100, 45000)$$, :'memory_perfect'),
  'duplicate', 'a retry of the same Memory Flash run is safe to repeat'
);
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-1111-4111-8111-eeeeeeeeeeee'::uuid, array[8], 10, 45000)$$,
  'closed', 'a closed Memory Flash session does not accept a different run'
);
-- Refusals, all leaving the loss fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, %s, 999, 45000)$$, :'memory_perfect'),
  'score_mismatch', 'a Memory Flash score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, %s, 999, 45000)$$, :'memory_perfect'),
  'score', '100', 'the Memory Flash replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, array[8,8], 10, 45000)$$,
  'invalid_actions', 'a Memory Flash run that stops before the tenth pattern is partial'
);
-- A pattern is a set: the same cell twice is a mistake even though it is in the
-- pattern, and the round it broke is still scored.
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, array[8,8,8], 30, 45000)$$,
  'score_mismatch', 'repeating a lit cell ends the run, so only the cleared pattern scores'
);
select rls_test.says_field(
  $$public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, array[8,8,8], 30, 45000)$$,
  'score', '10', 'a repeated cell keeps the points of the round it completed'
);
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, array[8,16], 10, 45000)$$,
  'invalid_actions', 'a cell that does not exist is impossible play'
);
select rls_test.raises(
  $$select public.complete_memory_flash_run('eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged Memory Flash action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-5555-4555-8555-eeeeeeeeeeee'::uuid, array[8], 10, 45000)$$,
  'wrong_rules', 'a Memory Flash session pinned to other rules is refused by its own verifier'
);
-- The loss is a recorded run, not a discarded one: round one rebuilt, the first
-- cell of round two entered, then a tap outside the pattern.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 10
      and r.cleared_columns = 1
      and r.tiles_placed = 3
     from public.complete_memory_flash_run(
       'eeeeeeee-2222-4222-8222-eeeeeeeeeeee'::uuid, array[8,8,0], 10, 45000) r),
  'a broken pattern is recorded: one cleared pattern, three taps, losing tap included'
);
select rls_test.ok(
  (select verified_score = 10 from public.game_sessions where id = 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee'),
  'a player can read the verified score on their own Memory Flash session'
);
select rls_test.ok(
  (select rank = 1 and score = 100 from public.game_standing('fixture-memory', '11111111-1111-4111-8111-111111111111', null)),
  'your Memory Flash standing is your recorded best at its real rank'
);

-- ── Memory Flash: the endless game, past the old tenth pattern ──
--
-- Seed 1 under memory-flash@2. Rounds one to eight are the retired game's
-- patterns, drawn on its 4×4 board; round nine is drawn on the 5×5 board the
-- pattern outgrew, and cell 22 — which the retired board did not have — is one of
-- its cells. The seventy-nine-tap line below clears rounds one to twelve, worth
-- 120 points, and ends with a cell round thirteen does not light.
--
-- The twelve taps of rounds nine to twelve are the point: a verifier that still
-- stopped at ten would call this line impossible (or record it as a ten-round
-- clear), so a recorded result with twelve cleared patterns is the proof the
-- former endpoint is gone.
--
-- The expected numbers are arithmetic from the seed, not values read back.
select rls_test.ok(
  (select public.memory_flash_rules_version() = 'memory-flash@2'),
  'the rules version a new Memory Flash session pins is the endless one'
);
select rls_test.ok(
  (select public.memory_flash_max_taps() = 4096),
  'the endless submission bound is a request ceiling, not a final round'
);
-- The board grows by a row and a column every eight rounds, without cap.
select rls_test.ok(
  (select public.memory_flash_side(1) = 4
      and public.memory_flash_side(8) = 4
      and public.memory_flash_side(9) = 5
      and public.memory_flash_side(17) = 6
      and public.memory_flash_side(90) = 15
      and public.memory_flash_cells_at(9) = 25
      and public.memory_flash_cells_at(90) = 225),
  'the board grows with the pattern: 4×4, then a row and a column every eight rounds'
);
-- The generator is internals — execute is not granted to a client, because the
-- verifier is its only caller — so the rounds are proved through the verifier
-- itself. The seventy-nine-tap line opens with the retired game's first eight
-- patterns (the fixture is those taps, cell for cell) and then taps cell 22, which
-- only the 5×5 board round nine is drawn on has. A recorded twelve-round result is
-- the proof that both holds.
--
-- The board can always hold the pattern it is asked to show: side(r)² ≥ r at every
-- round, for ever.
select rls_test.ok(
  (select bool_and(public.memory_flash_cells_at(r) >= r)
     from generate_series(1, 400) as r),
  'every round between one and four hundred fits on the board that round is drawn on'
);

-- The twelve-round line, recorded: twelve cleared patterns, 120 points, 79 taps
-- including the tap that broke round thirteen.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 120
      and r.cleared_columns = 12
      and r.tiles_placed = 79
     from public.complete_memory_flash_run(
       'eeeeeeee-3333-4333-8333-eeeeeeeeeeee'::uuid, :memory_endless, 120, 45000) r),
  'a run past the retired tenth pattern is recorded: twelve patterns, 79 taps, 120 points'
);
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-3333-4333-8333-eeeeeeeeeeee'::uuid, %s, 120, 45000)$$, :'memory_endless'),
  'duplicate', 'a retry of the same endless Memory Flash run is safe to repeat'
);
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-3333-4333-8333-eeeeeeeeeeee'::uuid, array[8], 10, 45000)$$,
  'closed', 'a closed endless Memory Flash session does not accept a different run'
);
select rls_test.ok(
  (select verified_score = 120 from public.game_sessions where id = 'eeeeeeee-3333-4333-8333-eeeeeeeeeeee'),
  'the endless run closes with its verified score on the session'
);
select rls_test.ok(
  (select rank = 1 and score = 120 from public.game_standing('fixture-memory-endless', :'alice'::uuid, null)),
  'a run past ten patterns ranks on the endless board at its real score'
);
-- Refusals, each leaving the open session open for the next attempt. A run that
-- stops before its mistake is a run the player ended, and is scored as it stands;
-- the wrong claims below keep the session open.
select rls_test.says_field(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, (%s::integer[])[1:78], 999999, 45000)$$, :'memory_endless'),
  'score', '120', 'an endless Memory Flash run ended before its losing tap is scored as it stands'
);
select rls_test.says_field(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, %s, 999999, 45000)$$, :'memory_eight_rounds'),
  'score', '80', 'an endless Memory Flash run the player ends after round eight is scored as it stands'
);
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, %s, 100, 45000)$$, :'memory_perfect'),
  'invalid_actions', 'the retired ten-pattern perfect line is not a finished endless run: round nine is drawn differently'
);
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, %s || 0, 120, 45000)$$, :'memory_endless'),
  'invalid_actions', 'a tap after the tap that broke an endless pattern is impossible play'
);
select rls_test.says(
  $$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, array[8,22], 10, 45000)$$,
  'invalid_actions', 'a cell only a later board has is impossible play in round one'
);
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, %s, 999, 45000)$$, :'memory_endless'),
  'score_mismatch', 'an endless score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, %s, 999, 45000)$$, :'memory_endless'),
  'score', '120', 'the endless replay is the score, and it is reported back'
);
-- And the same run, from the open session, is recorded exactly once.
select rls_test.says(
  format($$public.complete_memory_flash_run('eeeeeeee-6666-4666-8666-eeeeeeeeeeee'::uuid, %s, 120, 45000)$$, :'memory_endless'),
  'recorded', 'an endless run is recorded after the refused attempts leave the session open'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'eeeeeeee-6666-4666-8666-eeeeeeeeeeee'$$) = 1,
  'an endless Memory Flash run leaves exactly one score for its session'
);

-- ── One Move: the same properties, replayed against growing boards ──
--
-- Seed 1 wins on cells 7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5. The perfect line
-- restores all twelve boards in twelve taps for 120 points; the broken line
-- restores board one, then taps a cell board two does not win on: 10 points.
--
-- The expected numbers are arithmetic from the seed, not values read back.
-- One call, every number it derives: outcome, score, restored boards and taps.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 120
      and r.cleared_columns = 12
      and r.tiles_placed = 12
     from public.complete_one_move_run(
       'ffffffff-1111-4111-8111-ffffffffffff'::uuid, :one_move_perfect, 120, 45000) r),
  'a perfect One Move run is recorded: twelve boards, twelve taps, 120 points'
);
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-1111-4111-8111-ffffffffffff'::uuid, %s, 120, 45000)$$, :'one_move_perfect'),
  'duplicate', 'a retry of the same One Move run is safe to repeat'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-1111-4111-8111-ffffffffffff'::uuid, array[7], 10, 45000)$$,
  'closed', 'a closed One Move session does not accept a different run'
);
-- Refusals, all leaving the loss fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-2222-4222-8222-ffffffffffff'::uuid, %s, 999, 45000)$$, :'one_move_perfect'),
  'score_mismatch', 'a One Move score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_one_move_run('ffffffff-2222-4222-8222-ffffffffffff'::uuid, %s, 999, 45000)$$, :'one_move_perfect'),
  'score', '120', 'the One Move replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-2222-4222-8222-ffffffffffff'::uuid, array[7], 10, 45000)$$,
  'invalid_actions', 'a One Move run that stops before the twelfth board is partial'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-2222-4222-8222-ffffffffffff'::uuid, array[7,0,7], 10, 45000)$$,
  'invalid_actions', 'taps after the tap that ended the run are impossible play'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-2222-4222-8222-ffffffffffff'::uuid, array[9], 0, 45000)$$,
  'invalid_actions', 'a cell past the first board is impossible play'
);
select rls_test.raises(
  $$select public.complete_one_move_run('ffffffff-2222-4222-8222-ffffffffffff'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged One Move action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-5555-4555-8555-ffffffffffff'::uuid, array[7], 10, 45000)$$,
  'wrong_rules', 'a One Move session pinned to other rules is refused by its own verifier'
);
-- The loss is a recorded run, not a discarded one: board one restored, then a
-- losing tap on board two.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 10
      and r.cleared_columns = 1
      and r.tiles_placed = 2
     from public.complete_one_move_run(
       'ffffffff-2222-4222-8222-ffffffffffff'::uuid, array[7,0], 10, 45000) r),
  'a missed One Move is recorded: one restored board, two taps, losing tap included'
);
select rls_test.ok(
  (select verified_score = 10 from public.game_sessions where id = 'ffffffff-2222-4222-8222-ffffffffffff'),
  'a player can read the verified score on their own One Move session'
);
select rls_test.ok(
  (select rank = 1 and score = 120 from public.game_standing('fixture-one-move', '11111111-1111-4111-8111-111111111111', null)),
  'your One Move standing is your recorded best at its real rank'
);

-- ── Endless One Move: a board that keeps growing ──
--
-- Seed 1 wins on cells 7, 8, 7, 7, 0, 8, 6, 2, 5, 18, 13, 5 on the retired
-- boards, then 11, 21, 33, 20 on the first 6×6 board, then 20, 9, 47, 39 on the
-- first 7×7 board. Board twenty-one wins on 7; cell 0 is not its move, so the
-- line below is twenty restored boards for 200 points and ends on that miss.
--
-- The expected numbers are arithmetic from the seed, not values read back.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 200
      and r.cleared_columns = 20
      and r.tiles_placed = 21
     from public.complete_one_move_run(
       'ffffffff-3333-4333-8333-ffffffffffff'::uuid, :one_move_endless, 200, 45000) r),
  'an endless One Move run is recorded: twenty boards, twenty-one taps, 200 points'
);
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-3333-4333-8333-ffffffffffff'::uuid, %s, 200, 45000)$$, :'one_move_endless'),
  'duplicate', 'a retry of the same endless One Move run is safe to repeat'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-3333-4333-8333-ffffffffffff'::uuid, array[7], 10, 45000)$$,
  'closed', 'a closed endless One Move session does not accept a different run'
);
-- Refusals, all leaving the open fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-6666-4666-8666-ffffffffffff'::uuid, %s, 999, 45000)$$, :'one_move_endless'),
  'score_mismatch', 'an endless One Move score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_one_move_run('ffffffff-6666-4666-8666-ffffffffffff'::uuid, %s, 999, 45000)$$, :'one_move_endless'),
  'score', '200', 'the endless One Move replay is the score, and it is reported back'
);
select rls_test.says_field(
  format($$public.complete_one_move_run('ffffffff-6666-4666-8666-ffffffffffff'::uuid, %s, 999999, 45000)$$, :'one_move_perfect'),
  'score', '120', 'an endless One Move run the player ends after twelve boards is scored as it stands'
);
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-6666-4666-8666-ffffffffffff'::uuid, %s || 36, 120, 45000)$$, :'one_move_perfect'),
  'invalid_actions', 'a cell past board thirteen''s 6×6 board is impossible play'
);
select rls_test.says(
  $$public.complete_one_move_run('ffffffff-6666-4666-8666-ffffffffffff'::uuid, array[7,0,7], 10, 45000)$$,
  'invalid_actions', 'taps after the tap that ended an endless run are impossible play'
);
select rls_test.says(
  format($$public.complete_one_move_run('ffffffff-6666-4666-8666-ffffffffffff'::uuid, %s, 200, 45000)$$, :'one_move_endless'),
  'recorded', 'the endless run is recorded after the refused attempts leave the session open'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'ffffffff-6666-4666-8666-ffffffffffff'$$) = 1,
  'an endless One Move run leaves exactly one score for its session'
);
select rls_test.ok(
  (select rank = 1 and score = 200 from public.game_standing('fixture-one-move-endless', '11111111-1111-4111-8111-111111111111', null)),
  'your endless One Move standing is your recorded best at its real rank'
);

-- ── Queens: one Queen per row, column and region ──
--
-- Seed 1's first board is solved by cells 1, 8, 10, 19, 22 and its second by
-- 4, 7, 15, 18, 29, 32. The line solves board one (50 points), then makes three
-- mistakes on board two, and the third ends the run.
--
-- The expected numbers are arithmetic from the seed, not values read back.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 50
      and r.cleared_columns = 1
      and r.tiles_placed = 19
     from public.complete_queens_run(
       'c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0'::uuid, :queens_line, 50, 45000) r),
  'a Queens run is recorded: one board solved, nineteen taps, 50 points'
);
select rls_test.says(
  format($$public.complete_queens_run('c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0'::uuid, %s, 50, 45000)$$, :'queens_line'),
  'duplicate', 'a retry of the same Queens run is safe to repeat'
);
select rls_test.says(
  $$public.complete_queens_run('c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0'::uuid, array[1], 0, 45000)$$,
  'closed', 'a closed Queens session does not accept a different run'
);
-- Refusals, all leaving the open fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, %s, 999, 45000)$$, :'queens_two_boards'),
  'score_mismatch', 'a Queens score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, %s, 999, 45000)$$, :'queens_two_boards'),
  'score', '110', 'the Queens replay is the score, and it is reported back'
);
select rls_test.says(
  format($$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, %s || 5, 50, 45000)$$, :'queens_line'),
  'invalid_actions', 'a tap after the third mistake is impossible play'
);
select rls_test.says(
  $$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, array[0,0,0], 0, 45000)$$,
  'invalid_actions', 'a tap on a cell a mistake ruled out is impossible play'
);
select rls_test.says(
  $$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, array[25], 0, 45000)$$,
  'invalid_actions', 'a cell past the first 5×5 board is impossible play'
);
select rls_test.says(
  $$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, array[1,1], 50, 45000)$$,
  'score_mismatch', 'one Queen does not solve a board, so it scores nothing'
);
select rls_test.says(
  $$public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, array[1], 0, 999999)$$,
  'invalid_duration', 'a Queens run cannot claim to have lasted longer than its session'
);
select rls_test.raises(
  $$select public.complete_queens_run('c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged Queens action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_queens_run('c0c0c0c0-5555-4555-8555-c0c0c0c0c0c0'::uuid, array[1], 0, 45000)$$,
  'wrong_rules', 'a Queens session pinned to other rules is refused by its own verifier'
);
-- Ending a run is a prefix of a legal line: two boards solved and the run still
-- live is a recorded 110, because a run never loses points.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 110
      and r.cleared_columns = 2
      and r.tiles_placed = 22
     from public.complete_queens_run(
       'c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'::uuid, :queens_two_boards, 110, 45000) r),
  'a Queens run the player ended is recorded: two boards, twenty-two taps, 110 points'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'c0c0c0c0-2222-4222-8222-c0c0c0c0c0c0'$$) = 1,
  'a Queens run leaves exactly one score for its session'
);
select rls_test.ok(
  (select rank = 1 and score = 110 from public.game_standing('fixture-queens', '11111111-1111-4111-8111-111111111111', null)),
  'your Queens standing is your recorded best at its real rank'
);

-- ── Zip: one path through every cell, against the clock ──
--
-- Seed 1's first two boards are solved by the paths in :zip_two_boards. The line
-- solves board one, starts board two and stops: 50 points, thirty-one cells.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 50
      and r.cleared_columns = 1
      and r.tiles_placed = 31
     from public.complete_zip_run(
       'd1d1d1d1-1111-4111-8111-d1d1d1d1d1d1'::uuid, :zip_line, 50, 25000) r),
  'a Zip run is recorded: one board solved, thirty-one cells, 50 points'
);
select rls_test.says(
  format($$public.complete_zip_run('d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1'::uuid, %s, 50, 25000)$$, :'zip_line'),
  'duplicate', 'a retry of the same Zip run is safe to repeat'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-1111-4111-8111-d1d1d1d1d1d1'::uuid, array[8], 0, 25000)$$,
  'closed', 'a closed Zip session does not accept a different run'
);
-- Refusals, all leaving the open fixture open for the run that follows.
select rls_test.says_field(
  format($$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, %s, 999, 25000)$$, :'zip_two_boards'),
  'score', '100', 'the Zip replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, array[0], 0, 25000)$$,
  'invalid_actions', 'a Zip path must start on the cell numbered 1'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, array[8,0], 0, 25000)$$,
  'invalid_actions', 'a Zip path only steps to a neighbouring cell'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, array[8,8], 0, 25000)$$,
  'invalid_actions', 'the head of a Zip path is not a move'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, array[8,7,6,5,0,1], 0, 25000)$$,
  'invalid_actions', 'a Zip path does not go on past the last number'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, array[25], 0, 25000)$$,
  'invalid_actions', 'a cell past the first 5×5 board is impossible play'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, array[8,7,6,5,7,6], 10, 25000)$$,
  'score_mismatch', 'cutting a Zip path back and redrawing it is legal play, worth nothing until solved'
);
select rls_test.says(
  $$public.complete_zip_run('d1d1d1d1-5555-4555-8555-d1d1d1d1d1d1'::uuid, array[8], 0, 25000)$$,
  'wrong_rules', 'a Zip session pinned to other rules is refused by its own verifier'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 100 and r.cleared_columns = 2 and r.tiles_placed = 50
     from public.complete_zip_run(
       'd1d1d1d1-2222-4222-8222-d1d1d1d1d1d1'::uuid, :zip_two_boards, 100, 25000) r),
  'a Zip run that solved two boards is recorded at 100'
);
-- The clock is the server's. The late session started two minutes ago: one solved
-- board earns 85 s (+20 s of slack), so that run arrived too late; two solved
-- boards earn 110 s (+20), so that one is on time.
select rls_test.says(
  format($$public.complete_zip_run('d1d1d1d1-3333-4333-8333-d1d1d1d1d1d1'::uuid, %s, 50, 100000)$$, :'zip_board_one'),
  'out_of_time', 'a Zip run that arrives after its clock ran out is refused'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 100
     from public.complete_zip_run(
       'd1d1d1d1-3333-4333-8333-d1d1d1d1d1d1'::uuid, :zip_two_boards, 100, 100000) r),
  'a solved board buys time: the same arrival with two boards solved is on time'
);
select rls_test.ok(
  (select rank = 1 and score = 100 from public.game_standing('fixture-zip', '11111111-1111-4111-8111-111111111111', null)),
  'your Zip standing is your recorded best at its real rank'
);

-- ── 8 Puzzle: slide the tiles home, against the clock ──
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 10
      and r.cleared_columns = 1
      and r.tiles_placed = 12
     from public.complete_eight_puzzle_run(
       'e2e2e2e2-1111-4111-8111-e2e2e2e2e2e2'::uuid, :eight_line, 10, 25000) r),
  'an 8 Puzzle run is recorded: one board solved, twelve slides, 10 points'
);
select rls_test.says(
  format($$public.complete_eight_puzzle_run('e2e2e2e2-1111-4111-8111-e2e2e2e2e2e2'::uuid, %s, 10, 25000)$$, :'eight_line'),
  'duplicate', 'a retry of the same 8 Puzzle run is safe to repeat'
);
select rls_test.says(
  $$public.complete_eight_puzzle_run('e2e2e2e2-1111-4111-8111-e2e2e2e2e2e2'::uuid, array[5], 0, 25000)$$,
  'closed', 'a closed 8 Puzzle session does not accept a different run'
);
-- Refusals, all leaving the open fixture open for the run that follows.
select rls_test.says_field(
  format($$public.complete_eight_puzzle_run('e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'::uuid, %s, 999, 25000)$$, :'eight_two_boards'),
  'score', '20', 'the 8 Puzzle replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_eight_puzzle_run('e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'::uuid, array[0], 0, 25000)$$,
  'invalid_actions', 'an 8 Puzzle tile that is not next to the gap cannot slide'
);
select rls_test.says(
  $$public.complete_eight_puzzle_run('e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'::uuid, array[2], 0, 25000)$$,
  'invalid_actions', 'the 8 Puzzle gap itself is not a slide'
);
select rls_test.says(
  $$public.complete_eight_puzzle_run('e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'::uuid, array[9], 0, 25000)$$,
  'invalid_actions', 'a cell past the 3×3 board is impossible play'
);
select rls_test.says(
  $$public.complete_eight_puzzle_run('e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'::uuid, array[5,2], 10, 25000)$$,
  'score_mismatch', 'sliding a tile back and forth is legal play, worth nothing until solved'
);
select rls_test.says(
  $$public.complete_eight_puzzle_run('e2e2e2e2-5555-4555-8555-e2e2e2e2e2e2'::uuid, array[5], 0, 25000)$$,
  'wrong_rules', 'an 8 Puzzle session pinned to other rules is refused by its own verifier'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 20 and r.cleared_columns = 2 and r.tiles_placed = 19
     from public.complete_eight_puzzle_run(
       'e2e2e2e2-2222-4222-8222-e2e2e2e2e2e2'::uuid, :eight_two_boards, 20, 25000) r),
  'an 8 Puzzle run that solved two boards is recorded at 20'
);
-- The clock is the server's. The late session started a hundred seconds ago: one
-- solved board earns 75 s (+20 s of slack), too late; two earn 90 s (+20), on time.
select rls_test.says(
  format($$public.complete_eight_puzzle_run('e2e2e2e2-3333-4333-8333-e2e2e2e2e2e2'::uuid, %s, 10, 90000)$$, :'eight_board_one'),
  'out_of_time', 'an 8 Puzzle run that arrives after its clock ran out is refused'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 20
     from public.complete_eight_puzzle_run(
       'e2e2e2e2-3333-4333-8333-e2e2e2e2e2e2'::uuid, :eight_two_boards, 20, 90000) r),
  'a solved 8 Puzzle board buys time: the same arrival with two solved is on time'
);
select rls_test.ok(
  (select rank = 1 and score = 20 from public.game_standing('fixture-eight-puzzle', '11111111-1111-4111-8111-111111111111', null)),
  'your 8 Puzzle standing is your recorded best at its real rank'
);

-- ── Tango: suns and moons, against the clock ──
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 60
      and r.cleared_columns = 1
      and r.tiles_placed = 42
     from public.complete_tango_run(
       'a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7'::uuid, :tango_line, 60, 25000) r),
  'a Tango run is recorded: one board solved, forty-two taps, 60 points'
);
select rls_test.says(
  format($$public.complete_tango_run('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7'::uuid, %s, 60, 25000)$$, :'tango_line'),
  'duplicate', 'a retry of the same Tango run is safe to repeat'
);
select rls_test.says(
  $$public.complete_tango_run('a7a7a7a7-1111-4111-8111-a7a7a7a7a7a7'::uuid, array[1], 0, 25000)$$,
  'closed', 'a closed Tango session does not accept a different run'
);
-- Refusals, all leaving the open fixture open for the run that follows.
select rls_test.says_field(
  format($$public.complete_tango_run('a7a7a7a7-2222-4222-8222-a7a7a7a7a7a7'::uuid, %s, 999, 25000)$$, :'tango_two_boards'),
  'score', '120', 'the Tango replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_tango_run('a7a7a7a7-2222-4222-8222-a7a7a7a7a7a7'::uuid, array[0], 0, 25000)$$,
  'invalid_actions', 'a Tango cell that started filled cannot be tapped'
);
select rls_test.says(
  $$public.complete_tango_run('a7a7a7a7-2222-4222-8222-a7a7a7a7a7a7'::uuid, array[36], 0, 25000)$$,
  'invalid_actions', 'a cell past the 6×6 board is impossible play'
);
select rls_test.says(
  $$public.complete_tango_run('a7a7a7a7-2222-4222-8222-a7a7a7a7a7a7'::uuid, array[1,1,1,2], 10, 25000)$$,
  'score_mismatch', 'cycling cells is legal play, worth nothing until the board is solved'
);
select rls_test.says(
  $$public.complete_tango_run('a7a7a7a7-5555-4555-8555-a7a7a7a7a7a7'::uuid, array[1], 0, 25000)$$,
  'wrong_rules', 'a Tango session pinned to other rules is refused by its own verifier'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 120 and r.cleared_columns = 2 and r.tiles_placed = 85
     from public.complete_tango_run(
       'a7a7a7a7-2222-4222-8222-a7a7a7a7a7a7'::uuid, :tango_two_boards, 120, 25000) r),
  'a Tango run that solved two boards is recorded at 120'
);
-- The clock is the server's. The late session started two hundred seconds ago:
-- one solved board earns 165 s (+20 s of slack), too late; two earn 210 s (+20),
-- on time.
select rls_test.says(
  format($$public.complete_tango_run('a7a7a7a7-3333-4333-8333-a7a7a7a7a7a7'::uuid, %s, 60, 190000)$$, :'tango_board_one'),
  'out_of_time', 'a Tango run that arrives after its clock ran out is refused'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 120
     from public.complete_tango_run(
       'a7a7a7a7-3333-4333-8333-a7a7a7a7a7a7'::uuid, :tango_two_boards, 120, 190000) r),
  'a solved Tango board buys time: the same arrival with two solved is on time'
);
select rls_test.ok(
  (select rank = 1 and score = 120 from public.game_standing('fixture-tango', '11111111-1111-4111-8111-111111111111', null)),
  'your Tango standing is your recorded best at its real rank'
);

-- ── Saved progress: an unfinished run kept on the account ──
select rls_test.ok(
  public.save_run_progress('f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'::uuid, array[1,1,8], 20000) = 'saved',
  'a signed-in player saves their own unfinished run'
);
select rls_test.ok(
  (select progress_actions = array[1,1,8] and progress_played_ms = 20000
          and expires_at > now() + interval '11 hours'
     from public.game_sessions where id = 'f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'),
  'the saved moves and played time are on the session, which now stays open twelve hours'
);
select rls_test.ok(
  (select r.session_id = 'f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3' and r.actions = array[1,1,8]
          and r.played_ms = 20000 and r.seed = '1' and r.rules_version = 'queens@1'
     from public.saved_run('fixture-queens', 'queens@1') r),
  'the saved run is found to continue, with its seed as exact text'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.saved_run('fixture-queens', 'queens@2')$$) = 0,
  'a saved run is only found under the rules it was played under'
);
select rls_test.ok(
  public.save_run_progress('f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'::uuid, array[1,1,8], 999999999) = 'saved'
    and (select progress_played_ms <= 5 * 60 * 1000 + 5000
           from public.game_sessions where id = 'f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'),
  'saved played time never exceeds the time the session has existed'
);
select rls_test.ok(
  public.save_run_progress('f3f3f3f3-2222-4222-8222-f3f3f3f3f3f3'::uuid, array[1], 1000) = 'not_found',
  'a player cannot save to somebody else''s session'
);
select rls_test.ok(
  public.save_run_progress('c0c0c0c0-1111-4111-8111-c0c0c0c0c0c0'::uuid, array[1], 1000) = 'closed',
  'a recorded run cannot be saved over'
);
select rls_test.ok(
  public.save_run_progress('f3f3f3f3-3333-4333-8333-f3f3f3f3f3f3'::uuid, array[8], 1000) = 'not_resumable',
  'a timed run (Zip) is not saved: its clock cannot pause'
);
select rls_test.raises(
  $$select public.save_run_progress('f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'::uuid, array[null]::integer[], 0)$$,
  '22023', 'a ragged saved move list is a request error'
);
select rls_test.denied(
  $$update public.game_sessions set progress_actions = array[9] where id = 'f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'$$,
  'a player cannot write saved moves except through save_run_progress'
);
-- Continuing is just finishing the same session: the run is scored like any
-- other, from its seed, and then there is nothing left to continue.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 50
     from public.complete_queens_run(
       'f3f3f3f3-1111-4111-8111-f3f3f3f3f3f3'::uuid, (:queens_two_boards)[1:10], 50, 60000) r),
  'a continued run is verified and recorded like any other'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.saved_run('fixture-queens', 'queens@1')$$) = 0,
  'a finished run is no longer offered to continue'
);

-- ── Stats per game ──
-- Alice's Queens scores: 50, 110 and the continued run's 50.
select rls_test.ok(
  (select runs = 3 and best_score = 110 and total_score = 210 and rank = 1
          and last_played_at is not null
     from public.my_game_stats('fixture-queens')),
  'your stats for a game are your runs, best, total and rank from verified scores'
);
select rls_test.ok(
  (select runs = 0 and best_score is null and total_score = 0 and rank is null
     from public.my_game_stats('fixture-bob')),
  'a game you never scored on gives empty stats, not an error'
);

-- ── Color Merge: the same properties, replayed against a sliding board ──
--
-- Seed 1's legacy deck line plays all forty-eight slides for 272 points;
-- seed 15's legacy line locks the board after forty-two slides for 184. The
-- expected numbers are arithmetic from the seed, not values read back, and the
-- endless board below is measured the same way.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 272
      and r.tiles_placed = 48
     from public.complete_color_merge_run(
       '99999999-1111-4111-8111-999999999999'::uuid, :color_merge_deck, 272, 45000) r),
  'a full Color Merge deck is recorded: forty-eight slides, 272 points'
);
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-1111-4111-8111-999999999999'::uuid, %s, 272, 45000)$$, :'color_merge_deck'),
  'duplicate', 'a retry of the same Color Merge run is safe to repeat'
);
select rls_test.says(
  $$public.complete_color_merge_run('99999999-1111-4111-8111-999999999999'::uuid, array[2], 0, 45000)$$,
  'closed', 'a closed Color Merge session does not accept a different run'
);
-- A board that locks ends the run before the deck does, and is recorded.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 184
      and r.tiles_placed = 42
     from public.complete_color_merge_run(
       '99999999-6666-4666-8666-999999999999'::uuid, :color_merge_locked, 184, 45000) r),
  'a locked Color Merge board is recorded: forty-two slides, 184 points'
);
-- Refusals, all leaving the loss fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, %s, 999, 45000)$$, :'color_merge_deck'),
  'score_mismatch', 'a Color Merge score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, %s, 999, 45000)$$, :'color_merge_deck'),
  'score', '272', 'the Color Merge replay is the score, and it is reported back'
);
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, %s, 0, 45000)$$, :'color_merge_locked'),
  'invalid_actions', 'a Color Merge run that locks before the deck is partial'
);
select rls_test.says(
  $$public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, array[2,4], 0, 45000)$$,
  'invalid_actions', 'a direction past the board is impossible play'
);
select rls_test.says(
  $$public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, array[2,2], 0, 45000)$$,
  'invalid_actions', 'a slide that cannot change the board is not a move'
);
select rls_test.raises(
  $$select public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged Color Merge action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_color_merge_run('99999999-5555-4555-8555-999999999999'::uuid, array[2], 0, 45000)$$,
  'wrong_rules', 'a Color Merge session pinned to other rules is refused by its own verifier'
);
-- Play continues past the end of the deck only in a rejected submission.
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-2222-4222-8222-999999999999'::uuid, %s || 2, 272, 45000)$$, :'color_merge_deck'),
  'invalid_actions', 'a Color Merge run cannot slide after its deck ended'
);
-- The loss fixture is then played to its own end and recorded.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 272 and r.tiles_placed = 48
     from public.complete_color_merge_run(
       '99999999-2222-4222-8222-999999999999'::uuid, :color_merge_deck, 272, 45000) r),
  'a legal Color Merge deck is recorded, and its loss is included in the slides'
);
select rls_test.ok(
  (select verified_score = 272 from public.game_sessions where id = '99999999-2222-4222-8222-999999999999'),
  'a player can read the verified score on their own Color Merge session'
);
select rls_test.ok(
  (select rank = 1 and score = 272 from public.game_standing('fixture-color-merge', '11111111-1111-4111-8111-111111111111', null)),
  'your Color Merge standing is your recorded best at its real rank'
);
-- ── Endless Color Merge: past the retired deck, and only the board ends a run ──
--
-- Seed 1 plays sixty-four slides before its board locks: sixteen more than the
-- old deck allowed, and 468 points. Seed 15 locks at fifty-two for 292. The
-- legacy forty-eight-slide line no longer ends anything.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 468
      and r.tiles_placed = 64
     from public.complete_color_merge_run(
       '99999999-3333-4333-8333-999999999999'::uuid, :color_merge_endless_one, 468, 45000) r),
  'an endless Color Merge run is recorded: sixty-four slides, 468 points'
);
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-3333-4333-8333-999999999999'::uuid, %s, 468, 45000)$$, :'color_merge_endless_one'),
  'duplicate', 'a retry of the same endless Color Merge run is safe to repeat'
);
select rls_test.says(
  $$public.complete_color_merge_run('99999999-3333-4333-8333-999999999999'::uuid, array[2], 0, 45000)$$,
  'closed', 'a closed endless Color Merge session does not accept a different run'
);
select rls_test.ok(
  (select rank = 1 and score = 468 from public.game_standing('fixture-color-merge', '11111111-1111-4111-8111-111111111111', null)),
  'an endless Color Merge score becomes the standing, past the old deck best'
);
-- Seed 1's lines are not lines seed 15's board can produce: one of their slides
-- changes nothing on it.
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-7777-4777-8777-999999999999'::uuid, %s, 272, 45000)$$, :'color_merge_deck'),
  'invalid_actions', 'another seed''s deck line is impossible play on an endless board'
);
select rls_test.says_field(
  format($$public.complete_color_merge_run('99999999-7777-4777-8777-999999999999'::uuid, (%s)[1:40], 999999, 45000)$$, :'color_merge_endless_two'),
  'score', '184', 'an endless Color Merge run the player ends before its board locks is scored as it stands'
);
select rls_test.says_field(
  format($$public.complete_color_merge_run('99999999-7777-4777-8777-999999999999'::uuid, %s, 999, 45000)$$, :'color_merge_endless_two'),
  'score', '292', 'the endless Color Merge replay is the score, and it is reported back'
);
select rls_test.says(
  format($$public.complete_color_merge_run('99999999-7777-4777-8777-999999999999'::uuid, %s || 1, 468, 45000)$$, :'color_merge_endless_one'),
  'invalid_actions', 'a slide after the endless board locked is impossible play'
);
-- The loss fixture is then played to its own lock and recorded: a second board,
-- a different length, and no deck anywhere in it.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 292 and r.tiles_placed = 52
     from public.complete_color_merge_run(
       '99999999-7777-4777-8777-999999999999'::uuid, :color_merge_endless_two, 292, 45000) r),
  'a second endless board locks at fifty-two slides for 292 points'
);

-- ── Don't Touch the Black: the same properties, replayed against a conveyor ──
--
-- Two rulesets are verified against each other's fixtures. The dont-touch@1
-- sessions from the previous migration are replayed exactly as they were: seed
-- 1's perfect line clears all forty-one whites for 410 points, and the cautious
-- line clears nine whites and then touches the black tile at cell 15 for 90.
-- The dont-touch@2 fixtures are Bob's, and have no final row: the first
-- twenty-five rows hold fifty-six whites (560 points, cells 60–74 among them),
-- and an opening row of two whites then black scores 20.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 410
      and r.cleared_columns = 41
      and r.tiles_placed = 41
     from public.complete_dont_touch_run(
       '77777777-1111-4111-8111-777777777777'::uuid, :dont_touch_perfect, 410, 45000) r),
  'a perfect Don''t Touch the Black deck is recorded: forty-one whites, 410 points'
);
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-1111-4111-8111-777777777777'::uuid, %s, 410, 45000)$$, :'dont_touch_perfect'),
  'duplicate', 'a retry of the same Don''t Touch the Black run is safe to repeat'
);
select rls_test.says(
  $$public.complete_dont_touch_run('77777777-1111-4111-8111-777777777777'::uuid, array[2], 10, 45000)$$,
  'closed', 'a closed Don''t Touch the Black session does not accept a different run'
);
-- Refusals, all leaving the loss fixture open for the run that follows.
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-2222-4222-8222-777777777777'::uuid, %s, 999, 45000)$$, :'dont_touch_loss'),
  'score_mismatch', 'a Don''t Touch the Black score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_dont_touch_run('77777777-2222-4222-8222-777777777777'::uuid, %s, 999, 45000)$$, :'dont_touch_loss'),
  'score', '90', 'the Don''t Touch the Black replay is the score, and it is reported back'
);
select rls_test.says(
  $$public.complete_dont_touch_run('77777777-2222-4222-8222-777777777777'::uuid, array[60], 0, 45000)$$,
  'invalid_actions', 'a cell past the deck is impossible play'
);
select rls_test.says(
  $$public.complete_dont_touch_run('77777777-2222-4222-8222-777777777777'::uuid, array[2,2], 20, 45000)$$,
  'invalid_actions', 'a tile cleared twice is not two taps'
);
-- A black tile ends the run, so nothing may follow it in the same submission.
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-2222-4222-8222-777777777777'::uuid, %s || 16, 100, 45000)$$, :'dont_touch_loss'),
  'invalid_actions', 'a Don''t Touch the Black run cannot continue after the black tile'
);
select rls_test.raises(
  $$select public.complete_dont_touch_run('77777777-2222-4222-8222-777777777777'::uuid, array[null]::integer[], 0, 45000)$$,
  '22023', 'a ragged Don''t Touch the Black action list is a request error, not a scored run'
);
select rls_test.says(
  $$public.complete_dont_touch_run('77777777-5555-4555-8555-777777777777'::uuid, array[2], 0, 45000)$$,
  'wrong_rules', 'a Don''t Touch the Black session pinned to other rules is refused by its own verifier'
);
-- Endless refusals, on a session that is still open.
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-7777-4777-8777-777777777777'::uuid, %s, 999, 45000)$$, :'dont_touch_endless_loss'),
  'score_mismatch', 'an endless Don''t Touch the Black score the replay does not produce is refused'
);
select rls_test.says_field(
  format($$public.complete_dont_touch_run('77777777-7777-4777-8777-777777777777'::uuid, %s, 999, 45000)$$, :'dont_touch_endless_loss'),
  'score', '20', 'the endless Don''t Touch the Black replay is the score, and it is reported back'
);
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-7777-4777-8777-777777777777'::uuid, %s || 3, 30, 45000)$$, :'dont_touch_endless_loss'),
  'invalid_actions', 'an endless Don''t Touch the Black run cannot continue after the black tile'
);
select rls_test.says(
  $$public.complete_dont_touch_run('77777777-7777-4777-8777-777777777777'::uuid, array[0,0], 20, 45000)$$,
  'invalid_actions', 'an endless Don''t Touch the Black tile cleared twice is not two taps'
);
select rls_test.says(
  $$public.complete_dont_touch_run('77777777-7777-4777-8777-777777777777'::uuid, array[4095], 0, 45000)$$,
  'invalid_actions', 'a cell past the endless conveyor is impossible play'
);
-- The loss fixture is then played to its own end and recorded: nine whites are
-- scored, the black tile is the ending, and both are submitted.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 90 and r.tiles_placed = 10
     from public.complete_dont_touch_run(
       '77777777-2222-4222-8222-777777777777'::uuid, :dont_touch_loss, 90, 45000) r),
  'a legal Don''t Touch the Black run is recorded, and its black tap is included'
);
-- Missing every row is a real run: no black tile, no whites, zero points. The
-- verifier records it rather than calling it partial, because whether the deck
-- passed is the conveyor's fact, not the action list's.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 0 and r.tiles_placed = 0
     from public.complete_dont_touch_run(
       '77777777-6666-4666-8666-777777777777'::uuid, array[]::integer[], 0, 45000) r),
  'a Don''t Touch the Black run with no taps is recorded at zero'
);
select rls_test.ok(
  (select verified_score = 410 from public.game_sessions where id = '77777777-1111-4111-8111-777777777777'),
  'a player can read the verified score on their own legacy Don''t Touch the Black session'
);
-- The endless conveyor: a run that cleared twenty-five rows rather than stopping
-- at a final one, including cells past the legacy sixty-cell deck.
select rls_test.ok(
  (select r.outcome = 'recorded'
      and r.score = 560
      and r.cleared_columns = 56
      and r.tiles_placed = 56
     from public.complete_dont_touch_run(
       '77777777-3333-4333-8333-777777777777'::uuid, :dont_touch_endless, 560, 45000) r),
  'an endless Don''t Touch the Black run is recorded past the old twenty-row deck'
);
select rls_test.says(
  format($$public.complete_dont_touch_run('77777777-3333-4333-8333-777777777777'::uuid, %s, 560, 45000)$$, :'dont_touch_endless'),
  'duplicate', 'a retry of the same endless Don''t Touch the Black run is safe to repeat'
);
select rls_test.ok(
  (select verified_score = 560 from public.game_sessions where id = '77777777-3333-4333-8333-777777777777'),
  'a player can read the verified score on their own endless session'
);
-- The black tile still ends an endless run, and the tap that ended it is part of
-- the submission.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 20 and r.cleared_columns = 2 and r.tiles_placed = 3
     from public.complete_dont_touch_run(
       '77777777-7777-4777-8777-777777777777'::uuid, :dont_touch_endless_loss, 20, 45000) r),
  'a black tile ends the endless conveyor, and the ending tap is recorded'
);
-- Stopping at once is a real run: an endless game has no last row to reach, so
-- the explicit stop is the ending and zero points is the truthful score.
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 0 and r.tiles_placed = 0
     from public.complete_dont_touch_run(
       '77777777-8888-4888-8888-777777777777'::uuid, array[]::integer[], 0, 45000) r),
  'an immediately stopped Don''t Touch the Black run is recorded at zero'
);
select rls_test.ok(
  (select rank = 1 and score = 560 from public.game_standing('fixture-dont-touch', '11111111-1111-4111-8111-111111111111', null)),
  'your Don''t Touch the Black standing is your recorded best, endless run included'
);

-- 7 Second as a signed-in player: the same replay, but the recorded run earns a
-- score row and a standing. The empty line is valid — a clock can run out before
-- a first answer — and a session pinned to another rules version is refused.
select rls_test.ok(
  (select r.outcome = 'score_mismatch' and r.score = 30
     from public.complete_seven_second_run(
       '88888888-2222-4222-8222-888888888888'::uuid, array[0,1,2,1], 40, 45000) r),
  'a signed-in 7 Second claim the replay contradicts is refused'
);
select rls_test.ok(
  (select r.outcome = 'invalid_actions'
     from public.complete_seven_second_run(
       '88888888-2222-4222-8222-888888888888'::uuid, array[0,1,2,3], 30, 45000) r),
  'a 7 Second line with a choice past the buttons is impossible play'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 30 and r.tiles_placed = 4 and r.ranked
     from public.complete_seven_second_run(
       '88888888-2222-4222-8222-888888888888'::uuid, array[0,1,2,1], 30, 45000) r),
  'a signed-in 7 Second run is replayed, recorded at thirty, and ranked'
);
select rls_test.says(
  $$public.complete_seven_second_run('88888888-2222-4222-8222-888888888888'::uuid, array[0,1,2,1], 30, 45000)$$,
  'duplicate', 'a repeated signed-in 7 Second submission is recognised, not recorded twice'
);
select rls_test.says(
  $$public.complete_seven_second_run('88888888-1111-4111-8111-888888888888'::uuid, array[0,1,2,1], 30, 45000)$$,
  'already_played', 'a second session of the same day''s deck cannot become a second score'
);
select rls_test.ok(
  (select r.outcome = 'recorded' and r.score = 0 and r.tiles_placed = 0
     from public.complete_seven_second_run(
       '88888888-6666-4666-8666-888888888888'::uuid, array[]::integer[], 0, 45000) r),
  'a 7 Second run with no answers is recorded at zero'
);
select rls_test.says(
  $$public.complete_seven_second_run('88888888-5555-4555-8555-888888888888'::uuid, array[]::integer[], 0, 45000)$$,
  'wrong_rules', 'a 7 Second session pinned to rules this verifier does not implement is refused'
);
select rls_test.ok(
  (select verified_score = 30 from public.game_sessions where id = '88888888-2222-4222-8222-888888888888'),
  'a player can read the verified score on their own 7 Second session'
);
select rls_test.ok(
  (select rank = 1 and score = 30
     from public.game_standing('fixture-seven-second', '11111111-1111-4111-8111-111111111111', null)),
  'your 7 Second standing is your recorded best at its real rank'
);

-- Starting replaces your own open run, so a player cannot accumulate runs and
-- pick one to submit later. This runs after the completion tests on purpose:
-- replacing the open run is exactly what it does, and the fixtures above are
-- open until they are submitted.
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'started', 'a signed-in player starts a real run'
);
select rls_test.says(
  $$public.start_game_session('fixture-runnable', 'stack-10@1', 'test/1.0')$$,
  'started', 'starting again is allowed'
);
select rls_test.ok(
  rls_test.count_rows($$select id from public.game_sessions where game_id = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa'
    and user_id = '11111111-1111-4111-8111-111111111111' and completed_at is null and abandoned_at is null$$) = 1,
  'exactly one run stays open: the previous one was abandoned'
);
select rls_test.ok(
  rls_test.count_rows($$select id from public.game_sessions where game_id = 'aaaaaaaa-4444-4444-8444-aaaaaaaaaaaa'
    and user_id = '11111111-1111-4111-8111-111111111111' and abandoned_at is not null$$) >= 1,
  'the replaced run is marked abandoned rather than deleted'
);

reset role;

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;

-- The board is public, and it is the real ranking of the recorded score.
select rls_test.visible($$select * from public.game_leaderboard('fixture-runnable', null, 10, 0)$$, 1,
  'the board lists exactly the players with a recorded score'
);
select rls_test.ok(
  (select score = 55 and rank = 1 and plays = 1 from public.game_leaderboard('fixture-runnable', null, 10, 0)),
  'the top of the board is the verified score, at rank one, with one scored run'
);
select rls_test.ok(
  (select username is not null from public.game_leaderboard('fixture-runnable', null, 10, 0)),
  'a board entry names its player'
);
select rls_test.visible($$select * from public.game_standing('fixture-runnable', '22222222-2222-4222-8222-222222222222', null)$$, 0,
  'a player with no recorded score has no standing'
);
-- The Chain board is the same shape: one ranked player, the verified 55 on
-- top, two scored runs behind it (the perfect run and the broken chain).
select rls_test.visible($$select * from public.game_leaderboard('fixture-chain', null, 10, 0)$$, 1,
  'the Chain board lists exactly the players with a recorded score'
);
select rls_test.ok(
  (select score = 55 and rank = 1 and plays = 2 from public.game_leaderboard('fixture-chain', null, 10, 0)),
  'the top of the Chain board is the verified score, at rank one, with two scored runs'
);
-- The Memory Flash board: one ranked player, the perfect 100 on top, two scored
-- runs behind it (the perfect run and the broken pattern).
select rls_test.visible($$select * from public.game_leaderboard('fixture-memory', null, 10, 0)$$, 1,
  'the Memory Flash board lists exactly the players with a recorded score'
);
select rls_test.ok(
  (select score = 100 and rank = 1 and plays = 2 from public.game_leaderboard('fixture-memory', null, 10, 0)),
  'the top of the Memory Flash board is the verified score, at rank one, with two scored runs'
);
-- The all-games board is public too, and is derived from the same scores: the
-- player on top of the three boards above is rated in at least three games, and
-- a rating is never more than 100 per game.
select rls_test.ok(
  (select count(*) >= 1 from public.overall_leaderboard(null, 10, 0)),
  'the all-games board ranks a player rated in three games'
);
select rls_test.ok(
  (select bool_and(games >= 3 and rating between 0 and 100 * games and rank >= 1)
     from public.overall_leaderboard(null, 10, 0)),
  'every all-games row covers at least three games, at most 100 points each'
);
select rls_test.visible($$select * from public.overall_standing('22222222-2222-4222-8222-222222222222', null)$$, 0,
  'a player with no recorded score has no all-games standing'
);

reset role;

-- Row state, read as the table's owner: the guest run closed with a verified
-- score and wrote no ranked score row, and the retry wrote none either.
select rls_test.ok(
  (select verified_score = 55 and verified_digest is not null and completed_at is not null
     from public.game_sessions where id = 'cccccccc-4444-4444-8444-cccccccccccc'),
  'a guest run closes with a verified score on the session'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'cccccccc-4444-4444-8444-cccccccccccc'$$) = 0,
  'a guest run records no ranked score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'cccccccc-1111-4111-8111-cccccccccccc'$$) = 1,
  'a retried completion leaves exactly one score for the session'
);
select rls_test.ok(
  (select verified_score = 55 and verified_digest is not null and completed_at is not null
     from public.game_sessions where id = 'dddddddd-4444-4444-8444-dddddddddddd'),
  'a guest Chain run closes with a verified score on the session'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'dddddddd-4444-4444-8444-dddddddddddd'$$) = 0,
  'a guest Chain run records no ranked score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'dddddddd-2222-4222-8222-dddddddddddd'$$) = 1,
  'a broken chain leaves exactly one score for the session'
);
select rls_test.ok(
  (select verified_score = 100 and verified_digest is not null and completed_at is not null
     from public.game_sessions where id = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'),
  'a guest Memory Flash run closes with a verified score on the session'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'eeeeeeee-4444-4444-8444-eeeeeeeeeeee'$$) = 0,
  'a guest Memory Flash run records no ranked score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.scores where session_id = 'eeeeeeee-2222-4222-8222-eeeeeeeeeeee'$$) = 1,
  'a broken Memory Flash pattern leaves exactly one score for the session'
);

-- Plays are completed sessions, counted by the database: one ranked run plus one
-- guest run, one distinct signed-in player, and the best recorded score.
select rls_test.ok(
  (select plays = 2 and players = 1 and best_score = 55 from public.game_stats where slug = 'fixture-runnable'),
  'the public activity counts completed runs, distinct players and the best score'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.game_stats where slug = 'fixture-secret'$$) = 0,
  'an unpublished game is not in the public aggregate at all'
);
-- Chain activity counts the same way: three completed runs (two ranked, one
-- guest), one distinct signed-in player, and the best recorded score.
select rls_test.ok(
  (select plays = 3 and players = 1 and best_score = 55 from public.game_stats where slug = 'fixture-chain'),
  'the public activity counts Chain runs, players and the best score'
);
-- Memory Flash counts the same way: three completed runs (two ranked, one guest),
-- one distinct signed-in player, and the best recorded score.
select rls_test.ok(
  (select plays = 3 and players = 1 and best_score = 100 from public.game_stats where slug = 'fixture-memory'),
  'the public activity counts Memory Flash runs, players and the best score'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- New surfaces: preferences, blocks, follow notifications, following feed
-- ─────────────────────────────────────────────────────────────────────────────

select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

-- Preferences are strictly per-user.
select rls_test.allow(
  $$insert into public.user_preferences (user_id, private_account) values ('11111111-1111-4111-8111-111111111111', true)
    on conflict (user_id) do update set private_account = excluded.private_account$$,
  'a player can write their own preferences'
);
select rls_test.visible($$select user_id from public.user_preferences where user_id = '11111111-1111-4111-8111-111111111111'$$, 1,
  'a player reads their own preferences');
select rls_test.visible($$select user_id from public.user_preferences where user_id = '22222222-2222-4222-8222-222222222222'$$, 0,
  'another player''s preferences are invisible');
select rls_test.denied(
  $$insert into public.user_preferences (user_id) values ('22222222-2222-4222-8222-222222222222')$$,
  'a player cannot write another user''s preferences'
);

-- Blocks are strictly per-user, and self-blocks are rejected.
select rls_test.allow(
  $$insert into public.blocked_users (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    on conflict do nothing$$,
  'a player can block another account'
);
select rls_test.visible($$select blocked_id from public.blocked_users where blocker_id = '11111111-1111-4111-8111-111111111111'$$, 1,
  'a player reads their own block list');
select rls_test.rejected(
  $$insert into public.blocked_users (blocker_id, blocked_id) values ('11111111-1111-4111-8111-111111111111', '11111111-1111-4111-8111-111111111111')$$,
  'self-blocking is rejected'
);
select rls_test.denied(
  $$insert into public.blocked_users (blocker_id, blocked_id) values ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')$$,
  'a player cannot block as another user'
);

-- A genuine follow notifies the followee, and only the followee.
select rls_test.allow(
  $$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$,
  'a player can follow another account'
);
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.notifications where user_id = '11111111-1111-4111-8111-111111111111' and kind = 'follow'$$) = 0,
  'a follow notifies nobody except the followee'
);
-- Notification rows belong to the followee, so only the followee (or the
-- table owner, who bypasses RLS) can count them — alice reading bob's inbox
-- must see zero rows even though the row exists.
select rls_test.visible($$select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222' and kind = 'follow'$$, 0,
  'a follow notification is invisible to anyone but its recipient');
reset role;
select rls_test.ok(
  rls_test.count_rows($$select 1 from public.notifications where user_id = '22222222-2222-4222-8222-222222222222' and kind = 'follow'$$) = 1,
  'a follow creates exactly one follow notification for the followee'
);
select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;
select rls_test.blocked(
  $$insert into public.follows (follower_id, followee_id) values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')
    on conflict do nothing$$,
  'following an already-followed account touches no row (idempotent retry, no duplicate notification)'
);

-- The two profile statistics are measured from the graph, in both directions,
-- and a second follow attempt must not inflate them.
select rls_test.ok(
  (select count(*) from public.follows where followee_id = '22222222-2222-4222-8222-222222222222') = 1,
  'a profile''s followers count is the number of rows pointing at it'
);
select rls_test.ok(
  (select count(*) from public.follows where follower_id = '11111111-1111-4111-8111-111111111111') = 1,
  'a profile''s following count is the number of rows it owns'
);
select set_config('request.jwt.claims',
  json_build_object('sub', :'bob', 'role', 'authenticated')::text, true);
select rls_test.allow(
  $$insert into public.follows (follower_id, followee_id) values ('22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333')
    on conflict do nothing$$,
  'a second account can follow a third'
);
select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
select rls_test.ok(
  (select count(*) from public.follows where followee_id = '33333333-3333-4333-8333-333333333333') = 1,
  'followers are counted per profile, not globally'
);
select rls_test.ok(
  (select count(*) from public.follows where follower_id = '11111111-1111-4111-8111-111111111111') = 1,
  'another account''s follow does not change this profile''s following count'
);

-- The counts are public, like the graph itself: an anonymous visitor sees the
-- same numbers a signed-in reader does.
reset role;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select rls_test.ok(
  (select count(*) from public.follows where followee_id = '33333333-3333-4333-8333-333333333333') = 1,
  'an anonymous visitor can read the follower count'
);
reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', :'alice', 'role', 'authenticated')::text, true);
set local role authenticated;

-- The Following feed: bob's published game appears for alice, drafts and
-- official ownerless games do not, and strangers' games do not.
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50)) >= 1,
  'a follower''s feed is non-empty'
);
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where slug = 'fixture-bob') = 1,
  'the feed contains the followed creator''s published game'
);
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where slug = 'fixture-draft') = 0,
  'the feed never contains drafts'
);
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where is_official) = 0,
  'the feed never contains official ownerless games'
);
select rls_test.ok(
  (select count(*) from public.following_feed('33333333-3333-4333-8333-333333333333', 50)) = 0,
  'an account that follows nobody gets an empty feed, not an error'
);

reset role;

-- The feed reads public rows, so anonymous execution reveals nothing private.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select rls_test.ok(
  (select count(*) from public.following_feed('11111111-1111-4111-8111-111111111111', 50) where slug = 'fixture-bob') = 1,
  'the feed output is public data either way'
);
reset role;

rollback;

\echo 'RLS suite passed.'
