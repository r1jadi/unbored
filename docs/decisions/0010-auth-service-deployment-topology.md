# 0010 — The auth service deploys as a private Vercel service, reached by a binding from a container gateway

- Status: superseded by [0015](0015-direct-service-routing.md)
- Date: 2026-10-08
- Amends [0009](0009-vercel-deployment-topology.md)

## Context

[Phase 3](../architecture/api.md) turned `services/auth` into a real credential
service on top of Supabase Auth: sign-up, sign-in, refresh, sign-out and session
reads, with access tokens verified against the project's JWKS. It builds, it is
tested, and it serves `/api/v1/auth/*` on its own port. It has never been
deployed, so production answers that group with the gateway's `503` for a service
with no configured upstream.

[0009](0009-vercel-deployment-topology.md) put the gateway on Vercel's Go
framework preset as a second service of the existing web project. That deployment
works. What 0009 could not cover is a _second_ Go service that the gateway has to
call, because two of Vercel's ruled constraints meet here:

- **Service bindings are the only private route between services.** A service is
  internal by default; a binding both grants the caller access and generates the
  URL it calls. Vercel's documentation is explicit that
  "[service bindings] aren't available yet for services that use the Go or Rust
  runtime. If your service uses one of these runtimes and declares bindings, build
  it as a container image instead. A container image service can use bindings."
  The binding is declared on the **caller**, which here is the gateway.
- **The public entry must stay the gateway.** The requirement is one public
  surface: `https://unboredapp.vercel.app/api/v1/...`. Routing
  `/api/v1/auth/*` straight at the auth service with a top-level rewrite would
  expose a second public API surface and bypass the gateway's CORS, rate limiting
  and error envelope — the exact duplication 0009 avoided by deploying at all.

The alternatives were rejected:

- **A second Vercel project for the auth service.** Reintroduces the second public
  surface, a second CORS configuration and a second set of environment variables,
  and the gateway would need a fixed cross-project hostname — which a binding
  exists to avoid.
- **Running the auth service in the gateway process.** Two services become one
  binary, and the deployment stops being the thing that was tested: the auth
  service's own probes, its separate credential rate limiter and its independent
  scale-out all disappear.
- **A fetch over the public internet with a shared secret.** Turns an internal call
  into an authenticated public one, which is strictly more surface for no benefit.

## Decision

Deploy `services/auth` as a **third service of the same Vercel project**, made
reachable to the gateway by a **service binding**, and move the gateway to a
**container image** because it is the service that declares the binding.

- `vercel.json` declares three services:
  - `web` — repository root, `framework: "tanstack-start-lovable"` at the time, now `tanstack-start` (unchanged).
  - `api` — repository root, `runtime: "container"`,
    `entrypoint: "Dockerfile.vercel"`, which is the Go gateway.
  - `auth` — `root: "services/"`, `framework: "go"`,
    `entrypoint: "cmd/server/main.go"`.
- The binding is declared on **`api`** (the caller), not on `auth`:
  `{ "type": "service", "service": "auth", "format": "url", "env": "UPSTREAM_AUTH_URL" }`.
  Vercel generates the value and injects it into the gateway at runtime, scoped to
  the deployment — a preview's gateway reaches that preview's auth service. The
  variable is therefore **never** set in the dashboard: a project-level value is
  not deployment-aware and would win over the binding. `config.Load` already reads
  `UPSTREAM_AUTH_URL`, so no Go code changed to accommodate this.
- **No rewrite targets `auth`.** It stays internal, and the gateway remains the one
  public entry for `/api/v1/auth/*`. A binding grants reachability, not
  authorization, so the auth service still verifies the caller's access token for
  every authenticated endpoint.
- `Dockerfile.vercel` builds the gateway from a repository-root context with a
  `scratch` final stage, one static binary, a CA bundle and `ENV PORT=80`, so the
  app's listener and Vercel's router agree without a project-wide `PORT`. The
  context has to be the repository root because `services/go.mod` replaces the
  platform module with the relative path `../packages/go/platform`.
- `services/cmd/server/main.go` is the auth service's deployment entrypoint. It is
  `servicekit.MustRun(auth.Options())`, the same wiring as
  `services/auth/cmd/auth`, so the deployment and a local shell run one
  implementation.

Two Vercel details are load-bearing and were measured rather than assumed:

- The container file must be named exactly **`Dockerfile.vercel`** at the service
  root. A second, explicitly named entrypoint file
  (`Dockerfile.api.vercel` + `entrypoint`) was not detected at all, and the
  container service silently disappeared from the detected topology.
- A container service's **build context is its service root**, which is why `api`
  keeps `"root": "./"` instead of the `services/` root 0009 gave it.

## Consequences

- One project, one domain, one public surface, one firewall, one set of
  environment variables — 0009's outcome, preserved with a second backend.
- The gateway is now a container image instead of a Vercel Function. It keeps its
  scale-to-zero behaviour, but the image is built and pushed on every deploy, so a
  gateway-only change costs a container build. The image is small (a `scratch`
  layer with one static binary) and `.dockerignore` keeps the context to the two
  Go modules.
- The gateway's cost model changes from a Go Function to a container-backed
  function. Nothing in the gateway depends on being a Vercel Function; the reason
  for the move is documented above, not incidental.
- `/api/v1/auth/*` stops being a `503` and starts making real requests to Supabase.
  That is the point, and it is also the new failure mode: a missing
  `SUPABASE_PUBLISHABLE_KEY` now shows up as a `503` _from the auth service_
  instead of a `503` _from the gateway_. They are distinguishable — the gateway's
  unconfigured-group message is "This API is not available in this environment
  yet." and the auth service's is "Authentication is not available right now." —
  and the deployment doc's troubleshooting table uses that distinction.
- Vercel Services is still in Beta, and a binding on a container service is part of
  what is in Beta. A wrong configuration fails a build, not the running
  deployment: the previous production deployment stays live until a build
  succeeds.
- Reversing the decision is a revert of `vercel.json`, `Dockerfile.vercel` and
  `.dockerignore`, plus deleting `services/cmd/server` — the Go code itself is
  untouched by it and keeps running locally, in a container and on any host.
- `services/cmd/api/main.go` and `services/cmd/server/main.go` are now the two
  Vercel-specific files in the repository, and CI builds both alongside the
  fifteen service binaries so neither can rot.
