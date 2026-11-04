-- Minimal stand-in for the objects a hosted Supabase project provides:
-- the `auth` schema and its helper functions, the Data API roles, and the
-- `storage` schema with `storage.foldername()`.
--
-- Purpose: run the migrations and the RLS test suite against a throwaway
-- Postgres instance, in CI and locally, without a Supabase project.
--
-- This file is never applied to a hosted project. Apply order is
-- stub → migrations → seed → tests/security/rls_test.sql.

create schema if not exists auth;
create schema if not exists storage;
create schema if not exists extensions;

create extension if not exists citext with schema extensions;

-- ─────────────────────────────────────────────────────────────────────────────
-- Roles created by Supabase
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    -- BYPASSRLS mirrors the hosted service role: it is the server-side key.
    create role service_role noinherit bypassrls;
  end if;
end $$;

grant usage on schema auth, storage to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- auth.users — only the columns the migrations and policies touch
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text unique,
  encrypted_password text,
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  email_confirmed_at timestamptz,
  last_sign_in_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Auth helpers — same contract as the hosted versions
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    'anon'
  );
$$;

create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- storage — buckets, objects and the folder helper
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists storage.buckets (
  id                 text primary key,
  name               text not null,
  owner              uuid,
  public             boolean not null default false,
  avif_autodetection boolean not null default false,
  file_size_limit    bigint,
  allowed_mime_types text[],
  created_at         timestamptz not null default now()
);

create table if not exists storage.objects (
  id            uuid primary key default gen_random_uuid(),
  bucket_id     text references storage.buckets (id),
  name          text,
  owner         uuid,
  metadata      jsonb,
  path_tokens   text[] generated always as (string_to_array(name, '/')) stored,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  last_accessed_at timestamptz
);

alter table storage.objects enable row level security;

create or replace function storage.foldername(name text)
returns text[]
language plpgsql
stable
as $$
declare
  parts text[];
begin
  parts := string_to_array(name, '/');
  return parts[1:array_length(parts, 1) - 1];
end;
$$;

grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant select on storage.buckets to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Realtime: the table its private channels are authorized against, and send()
-- ─────────────────────────────────────────────────────────────────────────────

create schema if not exists realtime;
grant usage on schema realtime to anon, authenticated, service_role;

create table if not exists realtime.messages (
  id        bigint generated always as identity primary key,
  topic     text not null,
  extension text not null default 'broadcast',
  event     text,
  payload   jsonb,
  private   boolean default true
);
alter table realtime.messages enable row level security;
grant select, insert on realtime.messages to authenticated;

-- The channel being joined, which Realtime sets before it checks the policies.
create or replace function realtime.topic()
returns text
language sql
stable
as $$ select nullif(current_setting('realtime.topic', true), '') $$;

create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true)
returns void
language sql
as $$
  insert into realtime.messages (topic, event, payload, private)
  values (send.topic, send.event, send.payload, send.private);
$$;
