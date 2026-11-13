// Command standalone runs the whole public API — auth, users, the catalogue, play
// sessions, admin and the digest/feedback crons — in one process.
//
// It exists for hosts that run a single container (Render, Fly, Cloud Run, a
// VPS), where splitting the API into three deployments the way vercel.json does
// would cost three always-on instances. The route groups are the same packages
// the Vercel entrypoints mount (services/main.go, services/cmd/server,
// services/cmd/api); only the process boundary differs.
//
//	go run ./cmd/standalone          # from services/
//
// It listens on HTTP_ADDR, or PORT as most container hosts set it.
package main

import (
	"log/slog"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/admin"
	"github.com/r1jadi/unbored/services/auth"
	"github.com/r1jadi/unbored/services/game-sessions"
	gamesservice "github.com/r1jadi/unbored/services/games"
	"github.com/r1jadi/unbored/services/internal/apicache"
	"github.com/r1jadi/unbored/services/internal/apiroutes"
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/notifications"
	"github.com/r1jadi/unbored/services/users"
)

func main() {
	servicekit.MustRun(serve())
}

func serve() servicekit.Options {
	authOpts := auth.Options()
	usersOpts := users.Options()
	catalogue := gamesservice.Options()
	play := gamesessions.Options()
	operations := admin.Options()
	digests := notifications.Options()

	options := catalogue
	options.Register = apiroutes.RegisterVersion
	options.ExtraLimiters = append(append([]*httpx.RateLimiter{}, catalogue.ExtraLimiters...), authOpts.ExtraLimiters...)
	extra := catalogue.ExtraHandlers
	catalogueCache := apicache.New(60 * time.Second)
	options.ExtraHandlers = func(cfg *config.Config, logger *slog.Logger) []httpx.Middleware {
		middlewares := []httpx.Middleware{
			apiroutes.Unavailable(gamesservice.Name, auth.Name, users.Name),
			catalogueCache.Middleware(),
		}
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
		authOpts.RegisterWith(router, cfg, logger, verifier)
		usersOpts.RegisterWith(router, cfg, logger, verifier)
		catalogue.RegisterWith(router, cfg, logger, verifier)
		play.RegisterWith(router, cfg, logger, verifier)
		operations.RegisterWith(router, cfg, logger, verifier)
		digests.RegisterWith(router, cfg, logger, verifier)
	}
	return options
}
