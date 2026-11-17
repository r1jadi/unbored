-- Announcements that look like the notifications Unbored sends by itself.
--
-- A new game arrives as a card: a label with an icon ("New game"), the game's picture,
-- a headline, a short line and a button. An announcement used to be a plain line with a
-- bell. Now the administrator picks the same parts from a short list:
--
--   style   the label and icon: news, new_game, feature, event, theme, update
--   game    an optional published game, whose picture the card shows
--   action  the button: open, play, try or look ("Take a look")
--
-- A new-game announcement and a Play button need a game, and Play goes to that game.
-- Every other button goes to the link, so it needs one. A card with no game shows the
-- style's icon instead of a picture.
--
-- The functions change signature, so the old ones are dropped. Every existing caller
-- (the admin service, the security tests) passes only the leading arguments, which the
-- new defaults cover.
--
-- Apply before the admin service and the client.

alter table public.broadcasts
  add column if not exists style  text not null default 'news',
  add column if not exists game   text,
  add column if not exists action text;

do $$
begin
  alter table public.broadcasts add constraint broadcasts_style_known
    check (style in ('news', 'new_game', 'feature', 'event', 'theme', 'update'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.broadcasts add constraint broadcasts_action_known
    check (action is null or action in ('open', 'play', 'try', 'look'));
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.broadcasts add constraint broadcasts_game_slug
    check (game is null or game ~ '^[a-z0-9][a-z0-9-]{0,63}$');
exception when duplicate_object then null;
end $$;

do $$
begin
  alter table public.broadcasts add constraint broadcasts_parts_fit
    check (
      (style <> 'new_game' or game is not null)
      and (action is distinct from 'play' or game is not null)
      and (action is null or action = 'play' or link is not null)
    );
exception when duplicate_object then null;
end $$;

-- Checks the chosen parts and returns the game's title, or null with no game. The
-- table's checks say the same, but this says which part is wrong.
create or replace function public.broadcast_parts_check(
  p_style  text,
  p_game   text,
  p_action text,
  p_link   text
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_title text;
begin
  if p_style not in ('news', 'new_game', 'feature', 'event', 'theme', 'update') then
    raise exception 'unknown announcement style' using errcode = '22023';
  end if;
  if p_action is not null and p_action not in ('open', 'play', 'try', 'look') then
    raise exception 'unknown announcement button' using errcode = '22023';
  end if;
  if p_game is not null then
    select g.title into v_title
      from public.games g
     where g.slug = p_game::extensions.citext and g.status = 'published'
     limit 1;
    if v_title is null then
      raise exception 'no published game with that slug' using errcode = '22023';
    end if;
  end if;
  if p_style = 'new_game' and p_game is null then
    raise exception 'a new-game announcement needs a game' using errcode = '22023';
  end if;
  if p_action = 'play' and p_game is null then
    raise exception 'a Play button needs a game' using errcode = '22023';
  end if;
  if p_action is not null and p_action <> 'play' and p_link is null then
    raise exception 'this button needs a link' using errcode = '22023';
  end if;
  return v_title;
end;
$$;

revoke all on function public.broadcast_parts_check(text, text, text, text) from public, anon, authenticated;

-- ── Sending ─────────────────────────────────────────────────────────────────────

drop function if exists public.admin_send_broadcast_svc(uuid, text, text, text);
drop function if exists public.admin_send_broadcast(text, text, text);

create or replace function public.admin_send_broadcast(
  p_title  text,
  p_body   text,
  p_link   text default null,
  p_style  text default 'news',
  p_game   text default null,
  p_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := coalesce(public.admin_actor(), auth.uid());
  v_title      text := btrim(coalesce(p_title, ''));
  v_body       text := btrim(coalesce(p_body, ''));
  v_link       text := nullif(btrim(coalesce(p_link, '')), '');
  v_style      text := coalesce(nullif(btrim(coalesce(p_style, '')), ''), 'news');
  v_game       text := lower(nullif(btrim(coalesce(p_game, '')), ''));
  v_action     text := nullif(btrim(coalesce(p_action, '')), '');
  v_game_title text;
  v_id         uuid;
  v_recipients integer;
begin
  perform public.admin_guard_admin();
  v_game_title := public.broadcast_parts_check(v_style, v_game, v_action, v_link);

  -- The same announcement twice in ten minutes is a double click, not a decision.
  if exists (
    select 1 from public.broadcasts b
     where b.title = v_title and b.body = v_body
       and b.created_at > now() - interval '10 minutes'
  ) then
    raise exception 'this announcement was just sent' using errcode = '23505';
  end if;

  insert into public.broadcasts (title, body, link, style, game, action, sent_by)
  values (v_title, v_body, v_link, v_style, v_game, v_action, v_actor)
  returning id into v_id;

  -- Marked as already pushed for anyone with no device to push to. The sender treats an
  -- empty batch as "nothing left", so those rows must not sit in its outbox ahead of
  -- the players who do have one.
  insert into public.notifications (user_id, kind, payload, push_sent_at)
  select
    p.id,
    'system',
    jsonb_build_object(
      'reason', 'announcement',
      'broadcast', v_id,
      'title', v_title,
      'text', v_body,
      'link', v_link,
      'style', v_style,
      'game', v_game,
      'game_title', v_game_title,
      'action', v_action
    ),
    case
      when exists (select 1 from public.push_subscriptions s where s.user_id = p.id) then null
      else now()
    end
  from public.profiles p
  left join public.user_preferences up on up.user_id = p.id
  where not p.is_suspended
    and coalesce(up.notify_announcements, true);
  get diagnostics v_recipients = row_count;

  update public.broadcasts b set recipients = v_recipients where b.id = v_id;
  perform public.wake_push_dispatch_once();

  return jsonb_build_object('id', v_id, 'recipients', v_recipients);
end;
$$;

revoke all on function public.admin_send_broadcast(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_send_broadcast(text, text, text, text, text, text) to authenticated;

-- ── Editing ─────────────────────────────────────────────────────────────────────

drop function if exists public.admin_update_broadcast_svc(uuid, uuid, text, text, text);
drop function if exists public.admin_update_broadcast(uuid, text, text, text);

create or replace function public.admin_update_broadcast(
  p_id     uuid,
  p_title  text,
  p_body   text,
  p_link   text default null,
  p_style  text default 'news',
  p_game   text default null,
  p_action text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title      text := btrim(coalesce(p_title, ''));
  v_body       text := btrim(coalesce(p_body, ''));
  v_link       text := nullif(btrim(coalesce(p_link, '')), '');
  v_style      text := coalesce(nullif(btrim(coalesce(p_style, '')), ''), 'news');
  v_game       text := lower(nullif(btrim(coalesce(p_game, '')), ''));
  v_action     text := nullif(btrim(coalesce(p_action, '')), '');
  v_game_title text;
  v_updated    integer;
begin
  perform public.admin_guard_admin();
  v_game_title := public.broadcast_parts_check(v_style, v_game, v_action, v_link);

  update public.broadcasts b
     set title = v_title, body = v_body, link = v_link,
         style = v_style, game = v_game, action = v_action
   where b.id = p_id;
  if not found then
    raise exception 'no such announcement' using errcode = 'P0002';
  end if;

  update public.notifications n
     set payload = n.payload || jsonb_build_object(
           'title', v_title, 'text', v_body, 'link', v_link,
           'style', v_style, 'game', v_game, 'game_title', v_game_title, 'action', v_action)
   where n.payload ? 'broadcast'
     and n.payload ->> 'broadcast' = p_id::text;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('id', p_id, 'updated', v_updated);
end;
$$;

revoke all on function public.admin_update_broadcast(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_broadcast(uuid, text, text, text, text, text, text) to authenticated;

-- ── Listing ─────────────────────────────────────────────────────────────────────

drop function if exists public.admin_broadcasts_svc(uuid, integer, integer);
drop function if exists public.admin_broadcasts(integer, integer);

create or replace function public.admin_broadcasts(p_limit integer default 50, p_offset integer default 0)
returns table (
  id          uuid,
  title       text,
  body        text,
  link        text,
  style       text,
  game        text,
  action      text,
  sent_by_username text,
  recipients  integer,
  read_count  bigint,
  created_at  timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.admin_guard_staff();
  return query
  select
    b.id, b.title, b.body, b.link, b.style, b.game, b.action, p.username::text, b.recipients,
    (
      select count(*) from public.notifications n
       where n.payload ->> 'broadcast' = b.id::text
         and n.payload ? 'broadcast'
         and n.read_at is not null
    ),
    b.created_at
    from public.broadcasts b
    left join public.profiles p on p.id = b.sent_by
   order by b.created_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 100))
  offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

revoke all on function public.admin_broadcasts(integer, integer) from public, anon, authenticated;
grant execute on function public.admin_broadcasts(integer, integer) to authenticated;

-- ── The bridge for an allowlisted administrator ─────────────────────────────────

create or replace function public.admin_send_broadcast_svc(
  p_actor  uuid,
  p_title  text,
  p_body   text,
  p_link   text default null,
  p_style  text default 'news',
  p_game   text default null,
  p_action text default null
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
  return public.admin_send_broadcast(p_title, p_body, p_link, p_style, p_game, p_action);
end;
$$;

create or replace function public.admin_update_broadcast_svc(
  p_actor  uuid,
  p_id     uuid,
  p_title  text,
  p_body   text,
  p_link   text default null,
  p_style  text default 'news',
  p_game   text default null,
  p_action text default null
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
  return public.admin_update_broadcast(p_id, p_title, p_body, p_link, p_style, p_game, p_action);
end;
$$;

create or replace function public.admin_broadcasts_svc(
  p_actor uuid,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid, title text, body text, link text, style text, game text, action text,
  sent_by_username text, recipients integer, read_count bigint, created_at timestamptz
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
  return query select * from public.admin_broadcasts(p_limit, p_offset);
end;
$$;

revoke all on function public.admin_send_broadcast_svc(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_update_broadcast_svc(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_broadcasts_svc(uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.admin_send_broadcast_svc(uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_update_broadcast_svc(uuid, uuid, text, text, text, text, text, text) to service_role;
grant execute on function public.admin_broadcasts_svc(uuid, integer, integer) to service_role;
