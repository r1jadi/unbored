-- Editing and deleting an announcement after it was sent.
--
-- `admin_send_broadcast` and `admin_broadcasts` are untouched: sending and listing work
-- exactly as before. These two functions add the rest of the console's CRUD.
--
-- An announcement lives in two places: its `broadcasts` row, and a copy of its words in
-- the payload of every player's notification. Both functions change the two together,
-- so the console and the inboxes never disagree.
--
-- Administrator-only, like sending, with the usual `*_svc` wrapper for an allowlisted
-- administrator (see 20261015120000_admin_service_bridge.sql).
--
-- Apply before the admin service and the client.

-- Rewrites the words in place. Nobody is notified again: a notification already pushed
-- stays pushed, and one still waiting in the outbox goes out with the new words.
create or replace function public.admin_update_broadcast(
  p_id    uuid,
  p_title text,
  p_body  text,
  p_link  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title   text := btrim(coalesce(p_title, ''));
  v_body    text := btrim(coalesce(p_body, ''));
  v_link    text := nullif(btrim(coalesce(p_link, '')), '');
  v_updated integer;
begin
  perform public.admin_guard_admin();

  -- The table's own checks refuse a bad title, body or link.
  update public.broadcasts b
     set title = v_title, body = v_body, link = v_link
   where b.id = p_id;
  if not found then
    raise exception 'no such announcement' using errcode = 'P0002';
  end if;

  update public.notifications n
     set payload = n.payload || jsonb_build_object('title', v_title, 'text', v_body, 'link', v_link)
   where n.payload ? 'broadcast'
     and n.payload ->> 'broadcast' = p_id::text;
  get diagnostics v_updated = row_count;

  return jsonb_build_object('id', p_id, 'updated', v_updated);
end;
$$;

revoke all on function public.admin_update_broadcast(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.admin_update_broadcast(uuid, text, text, text) to authenticated;

-- Takes the announcement out of the console and out of every inbox. A real delete, not
-- a dismissal: with the broadcast gone there is no read count left for the rows to feed.
create or replace function public.admin_delete_broadcast(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removed integer;
begin
  perform public.admin_guard_admin();

  if not exists (select 1 from public.broadcasts b where b.id = p_id) then
    raise exception 'no such announcement' using errcode = 'P0002';
  end if;

  delete from public.notifications n
   where n.payload ? 'broadcast'
     and n.payload ->> 'broadcast' = p_id::text;
  get diagnostics v_removed = row_count;

  delete from public.broadcasts b where b.id = p_id;

  return jsonb_build_object('id', p_id, 'removed', v_removed);
end;
$$;

revoke all on function public.admin_delete_broadcast(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_broadcast(uuid) to authenticated;

-- ── The bridge for an allowlisted administrator ─────────────────────────────────

create or replace function public.admin_update_broadcast_svc(
  p_actor uuid,
  p_id    uuid,
  p_title text,
  p_body  text,
  p_link  text default null
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
  return public.admin_update_broadcast(p_id, p_title, p_body, p_link);
end;
$$;

create or replace function public.admin_delete_broadcast_svc(p_actor uuid, p_id uuid)
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
  return public.admin_delete_broadcast(p_id);
end;
$$;

revoke all on function public.admin_update_broadcast_svc(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.admin_delete_broadcast_svc(uuid, uuid) from public, anon, authenticated;

grant execute on function public.admin_update_broadcast_svc(uuid, uuid, text, text, text) to service_role;
grant execute on function public.admin_delete_broadcast_svc(uuid, uuid) to service_role;
