-- Web push: the same notifications, on a player's device when the app is closed.
--
-- A browser that opts in gets a subscription from its push service. Whether a
-- notification is wanted at all is already decided by the triggers in
-- 20261210120000_notification_triggers.sql, so push follows the same Settings
-- toggles and adds only the per-device choice. The notifications service reads and
-- sends these through the functions below (services/notifications/push.go).
--
-- The server posts to whatever URL a subscription holds, and a browser supplies that
-- URL. So the endpoint is limited to the real push services by a constraint: without
-- it, any signed-in player could point the server at an internal address (SSRF).
--
-- Waking the sender needs two secrets in Supabase Vault, and pg_net. Until they are
-- set, nothing is sent and nothing breaks. See services/notifications/README.md.
--
-- Apply before the client that offers push.

-- Where available, so this also applies to a database without the extension.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
exception when others then
  raise warning 'pg_net could not be enabled: %', sqlerrm;
end $$;

create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  endpoint     text not null,
  p256dh       text not null,
  auth         text not null,
  -- The language this device's notifications are worded in. It is per device, as
  -- the app's own language choice is.
  language     text not null default 'en',
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_host check (
    char_length(endpoint) <= 1024
    and endpoint ~ '^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com)/'
  ),
  constraint push_subscriptions_p256dh_format check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  constraint push_subscriptions_auth_format check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  constraint push_subscriptions_language_format check (language in ('en', 'sq'))
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id, last_seen_at desc);

-- RLS with no policies and no client grants. A subscription is a credential for
-- sending to someone's device, so it is reached only through the functions below.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant all on public.push_subscriptions to service_role;

-- The sender's outbox marker. Every existing row is history, not news.
alter table public.notifications add column if not exists push_sent_at timestamptz;
update public.notifications set push_sent_at = now() where push_sent_at is null;

create index if not exists notifications_push_pending_idx
  on public.notifications (created_at) where push_sent_at is null;

-- This device's subscription now belongs to the caller. A shared browser moves to
-- whoever is signed in, which is why this replaces the owner instead of refusing.
create or replace function public.register_push_subscription(
  p_endpoint text,
  p_p256dh   text,
  p_auth     text,
  p_language text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'a push subscription needs a signed-in account' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, language)
  values (v_user, p_endpoint, p_p256dh, p_auth, p_language)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        language = excluded.language,
        last_seen_at = now();

  -- Ten devices is plenty. Past that, the longest unseen ones go.
  delete from public.push_subscriptions s
   where s.user_id = v_user
     and s.id in (
       select o.id from public.push_subscriptions o
        where o.user_id = v_user
        order by o.last_seen_at desc
        offset 10
     );
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text) from public, anon, authenticated;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

-- Only ever the caller's own row.
create or replace function public.unregister_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s
   where s.endpoint = p_endpoint and s.user_id = auth.uid();
$$;

revoke all on function public.unregister_push_subscription(text) from public, anon, authenticated;
grant execute on function public.unregister_push_subscription(text) to authenticated;

-- Takes the next notifications to send and returns one row per device. A row is
-- stamped as it is claimed, so overlapping runs never send the same one twice. That
-- makes delivery at most once: a send that fails is not retried, which suits a
-- notification that is also waiting in the inbox.
create or replace function public.claim_push_batch(p_limit integer)
returns table (
  notification_id uuid,
  kind            text,
  payload         jsonb,
  subscription_id uuid,
  endpoint        text,
  p256dh          text,
  auth            text,
  language        text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Yesterday's news is not worth waking a phone for, if the sender was down.
  update public.notifications n
     set push_sent_at = now()
   where n.push_sent_at is null
     and n.created_at <= now() - interval '1 day';

  return query
  with claimed as (
    update public.notifications n
       set push_sent_at = now()
     where n.id in (
       select p.id from public.notifications p
        where p.push_sent_at is null
        order by p.created_at
        limit greatest(1, least(coalesce(p_limit, 100), 200))
        for update skip locked
     )
    returning n.id, n.kind, n.payload, n.user_id
  )
  select c.id, c.kind::text, c.payload, s.id, s.endpoint, s.p256dh, s.auth, s.language
    from claimed c
    join public.push_subscriptions s on s.user_id = c.user_id
   where c.kind in ('follow', 'comment', 'score');
end;
$$;

revoke all on function public.claim_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_push_batch(integer) to service_role;

-- A push service answered that a subscription no longer exists.
create or replace function public.delete_push_subscriptions(p_ids uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions s where s.id = any (p_ids);
$$;

revoke all on function public.delete_push_subscriptions(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_push_subscriptions(uuid[]) to service_role;

-- Asks the sender to run when there is something for it to do. pg_net queues the
-- request and sends it after commit, so this adds no wait to the follow, comment or
-- score that caused it. Everything is looked up at run time, so a database without
-- pg_net or Vault simply sends nothing.
create or replace function public.wake_push_dispatch()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
    return new;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return new;
  end if;

  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_url using 'push_dispatch_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_secret using 'push_dispatch_secret';
  if v_url is null or v_secret is null then
    return new;
  end if;

  execute 'select net.http_post(url := $1, headers := $2, body := ''{}''::jsonb)'
    using v_url, jsonb_build_object(
      'Authorization', 'Bearer ' || v_secret,
      'Content-Type', 'application/json'
    );
  return new;
exception when others then
  raise warning 'wake_push_dispatch failed: %', sqlerrm;
  return new;
end;
$$;

revoke all on function public.wake_push_dispatch() from public, anon, authenticated;

drop trigger if exists notifications_wake_push on public.notifications;
create trigger notifications_wake_push
  after insert on public.notifications
  for each row
  when (new.kind in ('follow', 'comment', 'score'))
  execute function public.wake_push_dispatch();
