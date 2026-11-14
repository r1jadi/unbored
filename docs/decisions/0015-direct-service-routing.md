# 0015 — Vercel routes each API group straight to its service; the gateway container is retired

- Status: superseded by [0016](0016-cloudflare-and-render-hosting.md) (production left Vercel on 2026-11-13)
- Date: 2026-11-12
- Supersedes [0010](0010-auth-service-deployment-topology.md); amends
  [0009](0009-vercel-deployment-topology.md) and
  [0011](0011-users-service-and-real-profile.md)

## Context

[0010](0010-auth-service-deployment-topology.md) put the gateway in front of the
Go services on Vercel. It reached them over service bindings. Bindings are not
available to Go-runtime services, so the gateway became a container image
(`Dockerfile.vercel`).

The project runs on Vercel's Hobby plan, which meters Fluid Active CPU and Fluid
Provisioned Memory. In the 30 days to 2026-11-12 the project used about 3h54m of
its 4h of Active CPU and 316 of its 360 GB-hrs of Provisioned Memory. By runtime:

| Runtime                         | Active CPU     | Provisioned Memory   |
| ------------------------------- | -------------- | -------------------- |
| container (the gateway)         | 3h 3m (75%)    | 302.8 GB-hrs (96%)   |
| executable (the three Go services) | 10m 51s (5%) | 10.3 GB-hrs (3%)    |
| nodejs (the web app's SSR)      | 49m 17s (20%)  | 3.2 GB-hrs (1%)      |

The gateway did no work of its own. Each service builds its server with the same
`servicekit` → `httpx.NewServer` chain: request ids, panic recovery, security
headers, CORS, stripping of client-supplied identity headers, request logging,
the body limit and the rate limiter. Each service also verifies the caller's token
itself (0003). So every API request ran that chain twice, and the first run was
in the most expensive runtime on the bill. The gateway also stayed provisioned
while it waited on the service behind it.

Two things only the gateway did:

- It translated the games service's "cacheable for guests" marker into
  `Vercel-CDN-Cache-Control`. It had to, because the Vercel hop in front of the
  service consumed that header.
- It answered `GET /api/v1` and returned `503` for route groups with no
  deployment.

## Decision

Vercel routes each `/api/v1` group straight to the service that owns it. The
gateway is not deployed there.

- `vercel.json` declares `web`, `auth`, `users` and `games`. It has no `api`
  service, no bindings and no container. The rewrites, in order:
  1. `/api/v1/auth` and `/api/v1/auth/(.*)` go to `auth`.
  2. `/api/v1/users` and `/api/v1/users/(.*)` go to `users`.
  3. `/api/v1`, `/api/v1/(.*)`, `/healthz` and `/readyz` go to `games`.
  4. Everything else goes to `web`.
- The games deployment (`services/main.go`) takes over what the gateway did:
  `apiroutes.RegisterVersion` for `GET /api/v1`, and `apiroutes.Unavailable("games")`
  for the `503`. The `503` covers groups owned by a service this process does not
  run.
- `services/internal/cdncache` turns the marker into `Vercel-CDN-Cache-Control`
  and `Cache-Control: public, max-age=0, must-revalidate` inside the games
  service. The games service is now the hop the CDN sees. As before, only a
  successful guest GET is ever marked cacheable.
- `Dockerfile.vercel` is deleted. The gateway stays in the repository as the local
  entrypoint (`scripts/dev-stack.mjs`). It is also the shape for any host that
  runs the services as plain processes, and its tests still run in CI.

## Consequences

- The Fluid metrics drop to what the services and the web app use. That is about
  1h of Active CPU and under 20 GB-hrs of Provisioned Memory over the same 30
  days at the same traffic. Each API call loses one hop and the container's cold
  start.
- The rule from 0010 that "the public entry must stay the gateway" no longer
  holds. It still holds where it counted: one origin, one versioned path, one CORS
  policy and one error envelope. All of those were already properties of every
  service.
- Rate limiting is per service and per instance, as it already was behind the
  gateway. The gateway's extra global bucket is gone. A shared store (0004) is the
  path if one is ever needed.
- A new public group needs a new service and its rewrite before the
  `/api/v1/(.*)` catch-all. A group nobody deploys answers `503` from the games
  deployment instead of silently reaching the wrong service.
- Whether Vercel's CDN acts on `Vercel-CDN-Cache-Control` set directly by a
  routed service has to be checked on the first preview (see
  [deployment/archive/vercel.md](../deployment/archive/vercel.md#3-verify-the-preview)). If it
  does not, guest reads are still correct, just uncached.
- Reversing the decision means restoring the `api` service, its bindings and
  `Dockerfile.vercel` from git history, and pointing the `/api/v1` rewrites back
  at `api`.
