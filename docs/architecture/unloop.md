# Unloop

Unloop is Unbored's short-video destination: vertical, full-screen loops that
administrators publish and everyone watches, likes, saves and shares. It is a
separate place in the app (`/unloop`, its own tab). The For You feed stays games
only, and no video ever appears in it.

## Who can do what

| Action                        | Guest | Signed in | Moderator | Administrator |
| ----------------------------- | :---: | :-------: | :-------: | :-----------: |
| Watch published loops         |   ✓   |     ✓     |     ✓     |       ✓       |
| Like, save                    |       |     ✓     |     ✓     |       ✓       |
| Share (link or share sheet)   |   ✓   |     ✓     |     ✓     |       ✓       |
| Upload, edit, publish, delete |       |           |           |       ✓       |

Administrator means the same thing as everywhere else in the admin API: a verified
email in `ADMIN_EMAILS` ([ADR 0013](../decisions/0013-admin-authorization.md)).
Every admin route is on the admin tier and re-checks it in the handler.

## How it is built

- **Database** — `supabase/migrations/20270123120000_unloop.sql`.
  `unloop_videos` has no grant for `anon` or `authenticated`; viewers read through
  `unloop_feed(...)`, which returns only published rows with measured like and save
  counts. `unloop_likes` and `unloop_saves` are owner-scoped under RLS and accept
  only published videos. Admin writes are definer functions guarded by
  `admin_guard_admin()`, each with a `_svc` wrapper for the service-role bridge.
  `tests/security/unloop_test.sql` checks all of it.
- **Storage** — the public `unloop` bucket (100 MB, MP4/WebM/MOV and
  JPEG/PNG/WebP). Nobody writes to it directly: the admin API mints a one-time
  signed upload URL for a path it chooses (`POST /admin/unloop/uploads`), and the
  browser sends the file straight there, so videos never pass through the API's
  1 MiB request limit. Replaced and deleted files are removed best effort.
- **API** — `services/admin/unloop.go`, documented in
  `packages/api-contracts/openapi-v1.yaml` under `/admin/unloop/*`.
- **Web** — `/unloop` (`src/components/unloop/`, `src/lib/unloop/`) and the
  studio at `/admin/unloop`. Likes, saves and the feed use the Supabase Data API
  with the caller's own token, like game likes and saves do
  (`src/lib/social/engagement.ts`).

## Operating it

- Uploading needs `SUPABASE_SECRET_KEY` on the API (the service-role bridge). Without
  it, signed uploads are minted as the caller and only an administrator who also
  has an `admin` row in `public.user_roles` can upload.
- The CSP allows `media-src` from the Supabase origin; videos stream from the
  bucket's public URLs.
- `/unloop` is indexable and listed in the sitemap (`INDEXABLE_PATHS` in
  `src/lib/seo.ts`). Shared links (`?v=…`) canonicalise to `/unloop`.
