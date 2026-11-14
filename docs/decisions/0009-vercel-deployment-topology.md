# 0009 — The Go gateway is a Vercel service of the existing web project

- Status: superseded by [0016](0016-cloudflare-and-render-hosting.md) (production left Vercel on 2026-11-13)
- Date: 2026-10-06
- Amended by [0010](0010-auth-service-deployment-topology.md): a second Go
  service needs a private route from the gateway, which requires the gateway to be
  a container image and moves its root back to `./`. The routing, the explicit
  per-service frameworks and the entrypoint pattern below still stand.
- Amended by [0015](0015-direct-service-routing.md): the gateway is no longer
  deployed on Vercel; each `/api/v1` group is routed straight to its service.

## Context

The API gateway exists, is tested and has never been deployed. The web app is
already live on Vercel (`https://unboredapp.vercel.app`) as a single project:
a TanStack Start app whose build emits a Nitro deployment. The requirement is one
public surface — `https://unboredapp.vercel.app/api/v1/...` routes to the Go
gateway — with no second provider, no second domain and no change to the approved
UI.

Vercel's Go support has two shapes. The classic one is `api/*.go` serverless
functions: one exported `http.HandlerFunc` per file, resolved from a `go.mod` at
the project root. The other is the Go **framework preset**, which builds a
standard `net/http` server and runs it as a service, handing the port to bind in
`PORT`.

Neither shape runs the gateway unchanged, and neither is a drop-in for a project
whose build output is already a prebuilt Nitro deployment: the `api/` directory is
not part of what that build emits, and a fixed `:8080` listener does not survive a
platform that assigns the port.

## Decision

Deploy the gateway as a **service of the existing Vercel project**, next to the web
app, using Vercel's Go framework preset:

- `vercel.json` declares two services — `web` (the repository root, framework
  `tanstack-start-lovable`) and `api` (`services/`, `framework: "go"`,
  `entrypoint: "cmd/api/main.go"`) — and routes `/api/v1`, `/api/v1/(.*)`,
  `/healthz` and `/readyz` to `api`, with a final catch-all to `web`. Routing into
  a service is final, so `/api/v1/*` can never fall through to the web app.
- Both frameworks are explicit because a service has no dashboard preset: the
  root contains a Nitro config, a TanStack Start app and a Node project at once,
  and Vercel refuses to choose between them ("Multiple frameworks detected in
  project root"). (Since the project left Lovable, the web service uses the generic `tanstack-start`;
  see docs/deployment/archive/vercel.md.) `tanstack-start-lovable` is the Lovable variant of the TanStack
  Start preset, which supersedes the generic detectors for a repository holding
  `@lovable.dev/vite-tanstack-config` and `@tanstack/react-start`.
- `services/cmd/api/main.go` is the deployment entrypoint Vercel detects. It is
  `servicekit.MustRun(gateway.Options())`: the same wiring the local
  `services/gateway/cmd/gateway` runs, extracted into `services/gateway` so the
  two entrypoints cannot diverge.
- `config.Load` resolves the listen address as `HTTP_ADDR` → `PORT_HTTP` → `PORT`,
  normalising a bare port to `:port`. No service assumes `:8080`; `:8080` is only
  the fallback for a developer's shell.
- Liveness becomes part of the published API: `GET /api/v1/health` answers
  `200 {"status":"ok","version":"…"}` with no authentication and no dependency
  checks. Readiness stays separate at `/readyz`, and the unversioned `/healthz`
  stays as it is.

Enabling services mode is a **dashboard change**: Vercel builds a project as
services only when the framework preset is _Services_ and `vercel.json` has a
`services` key. That step is documented in
[deployment/archive/vercel.md](../deployment/archive/vercel.md) because no repository change can
perform it.

## Consequences

- One project, one domain, one firewall, one set of environment variables. The
  gateway needs no database credentials and no CORS preflight for same-origin
  browser traffic.
- The gateway scales as a Vercel Function rather than as a container: cold starts
  are possible, in-process rate limiting is per instance, and a long-lived
  background task has no home there. Nothing in the gateway depends on being a
  single long-running process today; the limiter's documented Redis graduation path
  ([0004](0004-rate-limiting.md)) matters sooner on a platform that runs several
  instances.
- Vercel Services is in Beta, and the framework preset is not something this
  repository can verify. A wrong service configuration fails a deployment, not the
  running one: the previous production deployment stays live until a build
  succeeds.
- The `services/` module now has two entrypoints. `cmd/api` is the only Vercel
  specific file in the repository, and CI builds it alongside the fifteen service
  binaries so it cannot rot.
- Reversing the decision is a revert of `vercel.json` plus the framework preset —
  the Go code would keep running locally and in any container host unchanged.
- If Vercel's Go runtime ever rejects a plain `net/http` server, the alternative is
  a container-image service with the same `vercel.json` routing, which keeps the
  public surface identical.
