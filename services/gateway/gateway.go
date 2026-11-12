// Package gateway defines the public API gateway as a service definition.
//
// It terminates request-id generation, panic recovery, security headers, CORS,
// rate limiting and body limits, then forwards `/api/v1/<group>` to the service
// that owns that group (services/internal/apiroutes). Services behind it repeat
// authentication locally, so a routing mistake here cannot hand out access.
//
// The gateway is not part of the Vercel deployment: there, vercel.json routes each
// group straight to its service (docs/decisions/0015-direct-service-routing.md),
// because every service already runs the same middleware chain. It remains the
// single local entrypoint (scripts/dev-stack.mjs) and the shape for any host that
// runs the services as plain processes. No database credentials, no service key.
package gateway

import (
	"log/slog"

	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/gateway/internal/proxy"
	"github.com/r1jadi/unbored/services/internal/apiroutes"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

// Name is the service name used in logs and configuration validation.
const Name = "gateway"

// Options returns the wiring every gateway entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,

		// The reverse proxy is installed inside the standard middleware chain,
		// so proxied requests still get request ids, logging and headers.
		ExtraHandlers: func(cfg *config.Config, logger *slog.Logger) []httpx.Middleware {
			return []httpx.Middleware{proxy.New(cfg, logger).Middleware()}
		},

		Register: func(router *httpx.Router) {
			// Version discovery: clients and probes can confirm which API
			// version this deployment speaks without touching a service.
			apiroutes.RegisterVersion(router)
		},
	}
}
