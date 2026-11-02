-- Replies to comments.
--
-- `comments.parent_id` has existed since the core schema, but the insert policy
-- required it to be null, so only top-level comments could be written. This lets
-- a signed-in player reply to a visible top-level comment on the same published
-- game. Threads stay one level deep: a reply cannot itself be replied to, which
-- keeps moderation and pagination predictable.

drop policy if exists comments_insert_own on public.comments;
create policy comments_insert_own
  on public.comments for insert to authenticated
  with check (
    author_id = auth.uid()
    and not is_hidden
    and exists (select 1 from public.games g where g.id = game_id and g.status = 'published')
    and (
      parent_id is null
      or exists (
        select 1 from public.comments p
        where p.id = comments.parent_id
          and p.game_id = comments.game_id
          and p.parent_id is null
          and not p.is_hidden
      )
    )
  );
