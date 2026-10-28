-- Game release digests: one email to opted-in players after every five newly
-- published games.
--
-- What this adds:
--   * `user_preferences.notify_new_games` — explicit consent for the digest.
--     Default false: an account is never mailed because it merely exists.
--   * `game_release_digests` and its two child tables — a digest is five games
--     that have not been announced before, and a delivery row per recipient
--     makes a retry send nothing twice.
--   * Service-only functions that claim the next digest, list its games and
--     recipients, record a delivery and close the digest.
--   * `handle_new_user` also honours the "Product updates" choice made on the
--     sign-up form, which was previously collected and discarded.
--
-- The existing catalogue is recorded as one already-completed digest. It was
-- published before anyone could consent to this email, so it must never be sent.
--
-- Nothing here is client-readable: the tables have RLS enabled with no policies
-- and the functions are executable by `service_role` alone. The sender is the
-- notifications package mounted in the games deployment, reached by Vercel Cron
-- with CRON_SECRET.
--
-- Rollback (manual, only if this migration is not depended on):
--   drop function public.close_game_release_digest(uuid);
--   drop function public.record_game_release_digest_delivery(uuid, uuid, text);
--   drop function public.game_release_digest_recipients(uuid, integer);
--   drop function public.game_release_digest_games(uuid);
--   drop function public.claim_game_release_digest();
--   drop table public.game_release_digest_deliveries;
--   drop table public.game_release_digest_games;
--   drop table public.game_release_digests;
--   alter table public.user_preferences drop column notify_new_games;
--   -- then re-apply 20261112120000_signup_display_name.sql for handle_new_user.

-- ─────────────────────────────────────────────────────────────────────────────
-- Consent
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.user_preferences
  add column if not exists notify_new_games boolean not null default false;

comment on column public.user_preferences.notify_new_games is
  'Explicit consent to the "five new games" email digest. False by default; the sign-up form and Settings both write it.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Digest state (service-owned)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.game_release_digests (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- Null while recipients are still being mailed; set when every delivery row
  -- exists, or by the baseline row that records games published before launch.
  sent_at    timestamptz,
  -- True only for the one row that records the catalogue as it stood before this
  -- feature. It is never emailed, and it makes the migration's baseline step
  -- idempotent.
  is_baseline boolean not null default false,
  constraint game_release_digests_sent_after_creation
    check (sent_at is null or sent_at >= created_at)
);

create unique index if not exists game_release_digests_one_baseline
  on public.game_release_digests (is_baseline) where is_baseline;

comment on table public.game_release_digests is
  'One "five new games" email batch. An open row (sent_at is null) is still being delivered; a closed row is finished.';

create table if not exists public.game_release_digest_games (
  digest_id uuid not null references public.game_release_digests (id) on delete cascade,
  game_id   uuid not null references public.games (id) on delete cascade,
  primary key (digest_id, game_id),
  -- A game is announced at most once, ever. Republishing an old game therefore
  -- cannot send it a second time.
  constraint game_release_digest_games_announced_once unique (game_id)
);

comment on table public.game_release_digest_games is
  'The games in a digest. game_id is unique across the table: no game is announced twice.';

create table if not exists public.game_release_digest_deliveries (
  digest_id    uuid not null references public.game_release_digests (id) on delete cascade,
  user_id      uuid not null references auth.users (id) on delete cascade,
  delivered_at timestamptz,
  failed_at    timestamptz,
  -- A short machine-side reason. The Resend response is logged, never stored:
  -- it can echo the recipient address.
  failure      text,
  primary key (digest_id, user_id),
  constraint game_release_digest_deliveries_one_outcome
    check ((delivered_at is null) <> (failed_at is null)),
  constraint game_release_digest_deliveries_failure_shape
    check (
      (failure is null and delivered_at is not null)
      or (failure is not null and failed_at is not null and char_length(failure) between 1 and 200)
    )
);

comment on table public.game_release_digest_deliveries is
  'One row per recipient per digest. A retry skips anyone who already has a delivered or failed row.';

create index if not exists game_release_digest_games_digest_idx
  on public.game_release_digest_games (digest_id);

create index if not exists game_release_digest_deliveries_digest_idx
  on public.game_release_digest_deliveries (digest_id);

alter table public.game_release_digests enable row level security;
alter table public.game_release_digest_games enable row level security;
alter table public.game_release_digest_deliveries enable row level security;

revoke all on public.game_release_digests from anon, authenticated;
revoke all on public.game_release_digest_games from anon, authenticated;
revoke all on public.game_release_digest_deliveries from anon, authenticated;

grant all on public.game_release_digests to service_role;
grant all on public.game_release_digest_games to service_role;
grant all on public.game_release_digest_deliveries to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Service functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Claims the next digest. An open digest is returned as-is; otherwise the five
-- oldest published games that have never been announced are assigned to a new
-- one. Fewer than five leaves the catalogue untouched and answers NULL.
--
-- The advisory lock is transaction-scoped, so two overlapping cron invocations
-- cannot both create a digest from the same games.
create or replace function public.claim_game_release_digest()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_digest uuid;
  v_games  uuid[];
begin
  perform pg_advisory_xact_lock(hashtext('public.game_release_digests'));

  select d.id
    into v_digest
    from public.game_release_digests d
   where d.sent_at is null
   order by d.created_at, d.id
   limit 1;

  if v_digest is not null then
    return v_digest;
  end if;

  select array_agg(candidate.id order by candidate.published_at, candidate.id)
    into v_games
    from (
      select g.id, g.published_at
        from public.games g
       where g.status = 'published'
         and not exists (
           select 1
             from public.game_release_digest_games dg
            where dg.game_id = g.id
         )
       order by g.published_at asc nulls last, g.id
       limit 5
    ) candidate;

  if coalesce(array_length(v_games, 1), 0) < 5 then
    return null;
  end if;

  insert into public.game_release_digests default values
  returning id into v_digest;

  insert into public.game_release_digest_games (digest_id, game_id)
  select v_digest, unnest(v_games);

  return v_digest;
end;
$$;

comment on function public.claim_game_release_digest() is
  'Returns the open digest, or creates one from the next five published games that have never been announced. NULL until five are available.';

-- The digest's games, in publication order. Only games still published are
-- returned; a game archived in the meantime is not advertised.
create or replace function public.game_release_digest_games(p_digest_id uuid)
returns table (
  slug         text,
  title        text,
  instructions text
)
language sql
stable
security definer
set search_path = ''
as $$
  select g.slug::text, g.title, g.instructions
    from public.game_release_digest_games dg
    join public.games g on g.id = dg.game_id
   where dg.digest_id = p_digest_id
     and g.status = 'published'
   order by g.published_at asc nulls last, g.id;
$$;

comment on function public.game_release_digest_games(uuid) is
  'The published games in one digest, in publication order.';

-- Opted-in recipients who have not been handled for this digest yet. Bounded so
-- one cron invocation cannot run unbounded; the caller repeats until empty.
create or replace function public.game_release_digest_recipients(
  p_digest_id uuid,
  p_limit integer default 25
)
returns table (
  user_id      uuid,
  email        text,
  username     text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, u.email::text, p.username::text, p.display_name
    from public.user_preferences pref
    join public.profiles p on p.id = pref.user_id
    join auth.users u on u.id = pref.user_id
   where pref.notify_new_games
     and u.email is not null
     and u.email <> ''
     and u.email_confirmed_at is not null
     and not p.is_suspended
     and not exists (
       select 1
         from public.game_release_digest_deliveries d
        where d.digest_id = p_digest_id
          and d.user_id = p.id
     )
   order by p.id
   limit greatest(1, least(coalesce(p_limit, 25), 100));
$$;

comment on function public.game_release_digest_recipients(uuid, integer) is
  'Confirmed, unsuspended accounts that opted in and have no delivery row for this digest.';

-- Records one outcome, idempotently. A retried send cannot create two rows.
create or replace function public.record_game_release_digest_delivery(
  p_digest_id uuid,
  p_user_id uuid,
  p_failure text default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.game_release_digest_deliveries (
    digest_id, user_id, delivered_at, failed_at, failure
  )
  values (
    p_digest_id,
    p_user_id,
    case when nullif(btrim(p_failure), '') is null then now() end,
    case when nullif(btrim(p_failure), '') is not null then now() end,
    case when nullif(btrim(p_failure), '') is not null then left(btrim(p_failure), 200) end
  )
  on conflict (digest_id, user_id) do nothing;
$$;

comment on function public.record_game_release_digest_delivery(uuid, uuid, text) is
  'Marks one recipient as delivered (NULL failure) or failed (a short reason), once.';

-- Closes the digest only when no recipient is left. Safe to call repeatedly.
create or replace function public.close_game_release_digest(p_digest_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
      from public.game_release_digest_recipients(p_digest_id, 1)
  ) then
    return false;
  end if;

  update public.game_release_digests d
     set sent_at = coalesce(d.sent_at, now())
   where d.id = p_digest_id;

  return true;
end;
$$;

comment on function public.close_game_release_digest(uuid) is
  'Marks a digest finished when no recipient is left. Answers false while deliveries remain.';

revoke all on function public.claim_game_release_digest() from public, anon, authenticated;
revoke all on function public.game_release_digest_games(uuid) from public, anon, authenticated;
revoke all on function public.game_release_digest_recipients(uuid, integer) from public, anon, authenticated;
revoke all on function public.record_game_release_digest_delivery(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.close_game_release_digest(uuid) from public, anon, authenticated;

grant execute on function public.claim_game_release_digest() to service_role;
grant execute on function public.game_release_digest_games(uuid) to service_role;
grant execute on function public.game_release_digest_recipients(uuid, integer) to service_role;
grant execute on function public.record_game_release_digest_delivery(uuid, uuid, text) to service_role;
grant execute on function public.close_game_release_digest(uuid) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- Baseline: the catalogue as it stood before this feature
-- ─────────────────────────────────────────────────────────────────────────────

do $$
declare
  v_digest uuid;
begin
  -- Idempotent for a re-run: once the baseline exists, do not add a second one.
  if exists (
    select 1
      from public.game_release_digests d
     where d.is_baseline
  ) then
    return;
  end if;

  insert into public.game_release_digests (created_at, sent_at, is_baseline)
  values (now(), now(), true)
  returning id into v_digest;

  -- Every existing game, published or not: a draft that is published after
  -- launch is still an old game, not a release, and must never be announced.
  insert into public.game_release_digest_games (digest_id, game_id)
  select v_digest, g.id
    from public.games g;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Sign-up consent
-- ─────────────────────────────────────────────────────────────────────────────

-- Same trigger as 20261112120000, plus the "Product updates" choice. The
-- metadata key is `marketing`; only an explicit affirmative value writes a
-- preference row, so an account that did not opt in keeps the table's default
-- of false. An existing preference row is never overwritten.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_username text;
  requested_display_name text;
  candidate text;
  suffix integer := 0;
  wants_product_updates boolean;
begin
  requested_username := lower(btrim(coalesce(new.raw_user_meta_data ->> 'username', '')));

  if requested_username = '' then
    requested_username := null;
  elsif requested_username !~ '^[a-z0-9_]{3,24}$' then
    requested_username := null;
  end if;

  requested_display_name := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
  if char_length(requested_display_name) not between 1 and 60 then
    requested_display_name := null;
  end if;

  if requested_username is not null then
    -- A collision on `profiles_username_key` is deliberately not caught: it
    -- aborts the auth insert, so a taken name is a refused registration.
    candidate := requested_username;
  else
    candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 12);

    while exists (select 1 from public.profiles p where p.username = candidate) loop
      suffix := suffix + 1;
      if suffix > 99 then
        candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 16);
        exit;
      end if;
      candidate := 'user_' || substr(replace(new.id::text, '-', ''), 1, 10)
        || lpad(suffix::text, 2, '0');
    end loop;
  end if;

  insert into public.profiles (id, username, display_name, onboarded_at)
  values (
    new.id,
    candidate,
    coalesce(
      requested_display_name,
      left(
        coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), candidate),
        60
      )
    ),
    case
      when requested_username is not null and requested_display_name is not null then now()
    end
  )
  on conflict (id) do nothing;

  insert into public.user_roles (user_id, role)
  values (new.id, 'user')
  on conflict (user_id) do nothing;

  wants_product_updates :=
    lower(btrim(coalesce(new.raw_user_meta_data ->> 'marketing', ''))) in ('true', '1', 'on', 'yes');

  if wants_product_updates then
    insert into public.user_preferences (user_id, notify_new_games)
    values (new.id, true)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'Creates the profile and role rows for a new auth user. A username and display name supplied in raw_user_meta_data are honored; when both are present the sign-up form was completed, so onboarded_at is set. An explicit marketing opt-in writes notify_new_games. A taken username fails the insert via profiles_username_key.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Verification (run after applying):
--   select count(*) from public.game_release_digests;             -- >= 1 baseline
--   select count(*) from public.game_release_digest_games;        -- the pre-launch catalogue
--   select column_default from information_schema.columns
--    where table_name = 'user_preferences' and column_name = 'notify_new_games';
