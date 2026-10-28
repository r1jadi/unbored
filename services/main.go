// Command services is the Vercel deployment entrypoint for the catalogue, the
// play sessions and the admin API.
//
// Vercel's Go framework preset builds a service from a root `go.mod` plus one of
// exactly three entrypoint names — `main.go`, `cmd/api/main.go`,
// `cmd/server/main.go`. Auth owns `cmd/server` and users owns `cmd/api`, so the
// remaining slot is this file. There is no fourth slot, and a second container
// service at the same root was measured not to be detected at all (see
// docs/deployment/vercel.md), so the two route groups that a browser reaches
// through the gateway are mounted here together.
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
	"github.com/r1jadi/unbored/services/games"
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
	catalogue := games.Options()
	play := gamesessions.Options()
	operations := admin.Options()
	digests := notifications.Options()

	options := catalogue
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
