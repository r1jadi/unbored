-- In-app feedback.
--
-- Players send ideas, bugs and reactions from Settings → Send feedback. A row
-- belongs to its sender: they may add rows and read their own, staff read all,
-- and nobody edits or deletes through the Data API. A trigger caps how many a
-- player can send per hour so the form cannot be used to flood the table.

create table if not exists public.feedback (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  mood        smallint not null,
  category    text not null,
  message     text not null,
  context     text,
  created_at  timestamptz not null default now(),
  constraint feedback_mood_range check (mood between 1 and 5),
  constraint feedback_category_known check (category in ('idea', 'bug', 'praise', 'other')),
  constraint feedback_message_length check (char_length(message) between 3 and 2000),
  constraint feedback_context_length check (context is null or char_length(context) <= 300)
);

create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);

create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    select count(*) from public.feedback f
    where f.user_id = new.user_id and f.created_at > now() - interval '1 hour'
  ) >= 5 then
    raise exception 'feedback rate limit' using errcode = 'check_violation';
  end if;
  return new;
end $$;

revoke all on function public.feedback_rate_limit() from public, anon, authenticated;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.feedback_rate_limit();

alter table public.feedback enable row level security;

revoke all on public.feedback from anon, authenticated;
grant insert (mood, category, message, context, user_id) on public.feedback to authenticated;
grant select on public.feedback to authenticated;

drop policy if exists feedback_insert_own on public.feedback;
create policy feedback_insert_own
  on public.feedback for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists feedback_select_own_or_staff on public.feedback;
create policy feedback_select_own_or_staff
  on public.feedback for select to authenticated
  using (user_id = auth.uid() or public.is_staff());
