# 0016 — The website runs on Cloudflare Workers and the API on Render, as one process

- Status: accepted
- Date: 2026-11-13
- Supersedes [0009](0009-vercel-deployment-topology.md) and
  [0015](0015-direct-service-routing.md); amends
  [0011](0011-users-service-and-real-profile.md) (the users service is no longer a
  separate deployment)

## Context

Until now one Vercel project on the Hobby plan served everything: the TanStack
Start web app and three Go services, routed by `vercel.json`
([0015](0015-direct-service-routing.md)). Even after the gateway container was
retired, the project sat close to the plan's Fluid Active CPU and Provisioned
Memory limits, and three Go deployments meant three cold starts to warm.

The database is Supabase in `eu-west-1` (Ireland). Vercel's functions ran in a US
region, so every query paid a transatlantic round trip.

## Decision

- **Website:** Cloudflare Workers, built with Nitro's `cloudflare_module` preset
  (now the default in `vite.config.ts`) and deployed by Cloudflare's Git
  integration. It serves `unbored.lol`; `www.unbored.lol` redirects to it.
- **API:** one Render free web service, `unbored-api-eu`, in Frankfurt, defined by
  `render.yaml` and built from `infrastructure/docker/api.Dockerfile`. It runs
  `services/cmd/standalone`, which mounts every route group (auth, users,
  catalogue, play sessions, admin, digests) in one process. It is served at
  `api.unbored.lol`, a DNS-only Cloudflare CNAME.
- **Crons:** GitHub Actions (`.github/workflows/cron.yml`) calls
  `/api/v1/cron/*` with `CRON_SECRET`, at the times `vercel.json` used.
- **DNS:** the `unbored.lol` zone moves to Cloudflare.
- `vercel.json`, `@vercel/analytics` and `@vercel/speed-insights` are removed. The
  Vercel-named Go entrypoints (`services/main.go`, `services/cmd/server`,
  `services/cmd/api`) stay in the repository and in CI, so a return to Vercel is a
  config change, but they are not deployed.

## Consequences

- **Cost:** $0 for hosting, within the free plans' limits (Workers: 100k dynamic
  requests/day; Render: 750 instance-hours/month, so exactly one always-on service).
- **Latency:** the API is next to the database. The free Render instance sleeps
  after 15 idle minutes and takes up to a minute to wake; an external uptime
  monitor on `/healthz` keeps it awake.
- **Two origins:** the browser calls the API cross-origin, so CORS preflights
  return and `CORS_ALLOWED_ORIGINS` must list the site's origins. Auth is
  unaffected: the session is a bearer token, not a cookie.
- **No CDN for the API:** `Vercel-CDN-Cache-Control` (`services/internal/cdncache`)
  is inert. Guest catalogue reads are cached in memory for 60 s
  (`services/internal/apicache`).
- **One instance:** the in-process rate limiter ([0004](0004-rate-limiting.md)) is
  exact again. Scaling out would bring back the need for a shared store.
- **Product analytics** is PostHog only; the privacy page lists Cloudflare and
  Render as processors instead of Vercel.
- **Reversing it:** restore `vercel.json` from git history and point DNS back. Moving
  the API to another host only changes the `api` CNAME, not the website build.

Operational detail lives in [deployment/production.md](../deployment/production.md).
