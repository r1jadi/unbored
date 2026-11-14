// Command services is the former Vercel deployment entrypoint for the catalogue,
// the play sessions and the admin API.
//
// Legacy: no longer deployed. Production runs every route group in one process,
// services/cmd/standalone, on Render (docs/decisions/0016-cloudflare-and-render-hosting.md).
// This entrypoint is kept, and built in CI, so a return to Vercel stays a config
// change.
//
// Vercel's Go framework preset builds a service from a root `go.mod` plus one of
// exactly three entrypoint names — `main.go`, `cmd/api/main.go`,
// `cmd/server/main.go`. Auth owns `cmd/server` and users owns `cmd/api`, so the
// remaining slot is this file. There is no fourth slot, and a second container
// service at the same root was measured not to be detected at all (see
// docs/deployment/archive/vercel.md), so the route groups below are mounted here together.
//
// vercel.json routes /api/v1/auth/* and /api/v1/users/* to their own services and
// every other /api/v1 path here, with no gateway in between
// (docs/decisions/0015-direct-service-routing.md).
//
// The service *boundary* is unchanged: `services/games`, `services/game-sessions`,
// `services/admin` and `services/notifications` are separate packages with
// separate backends, route sets and authorization, each with its own binary for
// local development (`services/games/cmd/games`,
// `services/game-sessions/cmd/game-sessions`, `services/admin/cmd/admin`,
// `services/notifications/cmd/notifications`), and the routing table names the
// service each prefix belongs to. What is shared is one deployment, because the
// platform offers one; the digest route lives here because this deployment holds
// the secret key it needs.
//
// Sharing a process shares no privilege: the admin routes verify the caller's
// token and check the allowlist on every request, exactly as they would in a
// deployment of their own, and they hold no credential the catalogue routes do
// not also hold.
package main

import (
	"log/slog"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/admin"
	"github.com/r1jadi/unbored/services/game-sessions"
	gamesservice "github.com/r1jadi/unbored/services/games"
	"github.com/r1jadi/unbored/services/internal/apiroutes"
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/notifications"
)

func main() {
	servicekit.MustRun(serve())
}

// serve composes the two route groups into one service. Both register through
// `RegisterWith`, so they share the request verifier and the resolved
// configuration, and neither can be mounted without the other's middleware.
func serve() servicekit.Options {
	catalogue := gamesservice.Options()
	play := gamesessions.Options()
	operations := admin.Options()
	digests := notifications.Options()

	options := catalogue
	// On Vercel this deployment was also where every /api/v1 path that wasn't
	// auth or users landed (vercel.json), so it answers what the gateway used to: the version
	// route, and a 503 for a group nothing deploys yet.
	options.Register = apiroutes.RegisterVersion
	extra := catalogue.ExtraHandlers
	options.ExtraHandlers = func(cfg *config.Config, logger *slog.Logger) []httpx.Middleware {
		middlewares := []httpx.Middleware{apiroutes.Unavailable(gamesservice.Name)}
		if extra != nil {
			middlewares = append(middlewares, extra(cfg, logger)...)
		}
		return middlewares
	}
	options.RegisterWith = func(
		router *httpx.Router,
		cfg *config.Config,
		logger *slog.Logger,
		verifier *authn.Verifier,
	) {
		catalogue.RegisterWith(router, cfg, logger, verifier)
		play.RegisterWith(router, cfg, logger, verifier)
		operations.RegisterWith(router, cfg, logger, verifier)
		digests.RegisterWith(router, cfg, logger, verifier)
	}
	return options
}
