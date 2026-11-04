-- Signing in with a username: the one lookup that needs an email address.
--
-- Supabase Auth only takes a password against an email, so the auth service turns
-- the username into the account's address first. An address is private and a
-- username is public, so whoever can call this can turn one into the other. It is
-- therefore for the service role alone: it must never be granted to `anon` or
-- `authenticated`. Supabase's default privileges give new functions to both, which
-- is why they are revoked by name below rather than only from `public`.
--
-- Nothing here checks a password. A public function that did, to avoid needing the
-- service role, would let anyone guess passwords past Supabase's and the auth
-- service's rate limits.
--
-- Apply before the client that sends a username. Until then only that path fails.

create or replace function public.login_email_for_username(p_username text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.email::text
    from public.profiles p
    join auth.users u on u.id = p.id
   -- Named, because with an empty search_path a bare `=` is the plain text operator,
   -- which would quietly make this comparison case-sensitive.
   where p.username operator(extensions.=) p_username::extensions.citext
   limit 1;
$$;

comment on function public.login_email_for_username(text) is
  'The email address behind a username, for the auth service''s sign-in. Service role only: it turns a public name into a private address.';

revoke all on function public.login_email_for_username(text) from public, anon, authenticated;
grant execute on function public.login_email_for_username(text) to service_role;
