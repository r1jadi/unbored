# services/games

The public game catalogue: which games exist, what they are, how many published
games each category holds, how many runs each game has had, and each game's
leaderboard. It is the read side of the product — the screens that browse, search,
open and rank a game.

## Routes

| Route                                  | Auth          | What it does                                                                                                                                                                             |
| -------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/games`                    | public        | A page of published games, newest first. Filters: `category` (slug), `q` (substring over title, tagline and description), `sort` (only `latest`), `limit` (1–100, default 20), `cursor`. |
| `GET /api/v1/games/{slug}`             | public        | One published game, by its stable slug (`stack-10`), with its real play count.                                                                                                           |
| `GET /api/v1/games/{slug}/leaderboard` | optional      | The game's persisted ranking. A token only adds the caller's own standing as `me`.                                                                                                       |
| `GET /api/v1/games/leaderboard`        | optional      | The all-games board: each player's per-game percentiles, summed, for players rated in at least three games. A token adds the caller's rating as `me`.                                    |
| `GET /api/v1/categories`               | public        | Every category with its real published-game count.                                                                                                                                       |
| `POST /api/v1/games`                   | authenticated | **Planned** — answers `501`. Creating a game is a separate feature.                                                                                                                      |
| `PATCH /api/v1/games/{slug}`           | authenticated | **Planned** — answers `501`.                                                                                                                                                             |
| `POST /api/v1/games/{slug}/publish`    | authenticated | **Planned** — answers `501`. Publishing is a moderation decision.                                                                                                                        |

`x-status` in [`packages/api-contracts/openapi-v1.yaml`](../../packages/api-contracts/openapi-v1.yaml)
is the authority for which of these are implemented; the planned three exist so
the contract and the router cannot drift, and so a client gets a documented `501`
rather than an unexplained `404`.

The play sessions and the submission that verifies a score are the
[`game-sessions`](../game-sessions/README.md) package's routes. They are served by
the same _deployment_ (Vercel's Go preset has one entrypoint name left — see
[deployment/vercel.md](../../docs/deployment/vercel.md)) but not by this package:
the route table names `/api/v1/sessions` under the service that answers it.

## Play counts and boards

`plays` is a real measurement: the number of **completed** runs, counted in the
database by `public.game_stats` from persisted sessions. Zero means nobody has
finished the game, which is a fact rather than a missing value — so the field is
always present and always a number.

The board comes from `public.game_leaderboard`, which derives it from recorded
scores: each player's best score, the first time they reached it, how many scored
runs they had in the window, and ties sharing a rank. Both are `security invoker`,
so RLS still decides what a caller may see, and the service presents what the
database ranked without recomputing or caching it. A game nobody has played is an
empty board — an answer — while an unknown or unpublished game is a `404`, the same
answer as reading it.

The all-games board (`public.overall_leaderboard`, `public.overall_standing`) is
derived from the same scores. A score cannot be compared across games, so each
player's best in a game becomes a percentile of that game's players (`cume_dist`,
1–100), and the rating is their sum. A player is ranked once they have a
percentile in three games; below that, `me` still carries their rating with a
`null` rank. The window applies before the percentiles, so a weekly board compares
this week's players with each other.

`scope=friends` is refused with a `400` that explains itself: a friends board needs
a following graph, which does not exist yet.

## What the catalogue deliberately does not return

No response carries a like total, comment total, save total, rating, average
session duration or aggregate ranking. No service records any of them, and a
plausible-looking zero would be indistinguishable from a real measurement, so the
fields are absent and the UI renders nothing.

`sort` therefore accepts exactly one value: play counts exist, but a
play-weighted ranking is not implemented, and a `400` that says so is more honest
than a ranking computed from publication order.

`playable` is true only when a runtime genuinely exists — the database enforces
that with `games_playable_requires_runtime` — and Stack 10 is the only game with
one today. `runtime` is the runtime's identifier (`stack-10`), because the client
mounts a runtime by that name; the game's rules are documented in
[`docs/games`](../../docs/games/README.md).

## How it reads

Two properties of the client
([`internal/supabasegames/client.go`](internal/supabasegames/client.go)) matter:

- **Public reads use the publishable key and no user token.** The Data API answers
  as the `anon` role, so Row Level Security is the authority on what exists: an
  unpublished game is not filtered out by this service, it is not in the response
  at all. The service holds no credential that could read a draft.
- **The service never writes.** It reads the catalogue, the activity view and the
  board, and calls two read-only functions. Creating and editing games is a later
  feature, so a bug here cannot mutate production content — and it holds no
  credential that could.

An unknown slug and an unpublished game both answer `404`, which is why they must
stay indistinguishable: telling them apart would let a stranger enumerate drafts.

Category counts come from `public.category_game_counts`, a view whose
`status = 'published'` filter lives inside its definition — so a draft never
contributes, not even for a caller who could see it.

The activity view's projections name their columns: `slug` and `plays` are granted,
`game_id` is not. The internal uuid stays internal, exactly as it does in a game
response, and a request that asked for it would be refused by the grant rather than
by this service remembering to omit it.

## Cursors

Pagination is keyset, not offset: the cursor is the sort key of the last row of the
previous page (its `published_at` and `id`), base64url-encoded and opaque. A game
published between two requests therefore lands on a later page instead of shifting
every following row and duplicating one.

The client asks the Data API for one row more than the page size; that extra row is
how the handler knows another page exists without a `COUNT`.

## Running it locally

```bash
cd services
ENVIRONMENT=development \
SUPABASE_URL=https://<project-ref>.supabase.co \
SUPABASE_PUBLISHABLE_KEY=<publishable key> \
go run ./games/cmd/games            # serves :8080 by default
```

```bash
# Through the gateway, which is how the browser reaches it in production
UPSTREAM_GAMES_URL=http://localhost:8080 SERVICE_NAME=gateway HTTP_ADDR=:8081 \
  go run ./gateway/cmd/gateway
curl -s localhost:8081/api/v1/games | jq
```

Without `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` the service still boots,
serves its probes, and answers `503` on the catalogue routes — a diagnosable state
rather than a crash loop.

## Deployment

Deployed as the `games` service in [`vercel.json`](../../vercel.json) with
`"root": "services/"` and `"entrypoint": "main.go"`. That file is
[`services/main.go`](../main.go), and it exists only because Vercel's Go framework
preset recognises exactly three entrypoint names — `main.go`, `cmd/api/main.go` and
`cmd/server/main.go` — and the other two are taken by the users and auth services.
It is the same one line as [`cmd/games/main.go`](cmd/games/main.go), so the local
binary and the deployment cannot drift.

The gateway reaches it over the `UPSTREAM_GAMES_URL` service binding declared on the
`api` service, so the public path stays
`https://unboredapp.vercel.app/api/v1/games`. See
[deployment/vercel.md](../../docs/deployment/vercel.md).

## Tests

```bash
cd services && go test ./games/...
```

The suite covers the query the client builds, the cursor round-trip, every rejected
parameter, `404` for an unknown slug, the `503` when Supabase is unconfigured, the
real play count (and that an unreadable one fails the listing rather than reading as
zero), the board's paging, windows and scopes, that a standing is read for the
caller's token and for nobody else, and the absence of fabricated metrics from a
response. The database-side rules — unpublished games invisible to an anonymous
caller, the category count, and the board's derivation — are in
[`tests/security/rls_test.sql`](../../tests/security/rls_test.sql), run by
`./scripts/test-rls.sh`.
