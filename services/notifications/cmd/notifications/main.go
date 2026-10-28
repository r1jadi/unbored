// Command notifications owns in-app and push notifications.
//
// Reads and writes are scoped to the verified user: there is no parameter that
// selects another recipient. Delivery providers (email, push) are configured
// server-side only. The game-release digest is mounted in the games deployment
// because that deployment holds the secret key; this local binary serves the
// same route so it can be exercised on its own.
package main

import (
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/servicekit"
	notificationservice "github.com/r1jadi/unbored/services/notifications"
)

const serviceName = "notifications"

func main() {
	options := notificationservice.Options()
	options.Register = func(router *httpx.Router) {
		router.AuthenticatedFunc("GET /api/v1/notifications",
			httpx.NotImplemented(serviceName, "Listing notifications"))

		router.AuthenticatedFunc("POST /api/v1/notifications/read",
			httpx.NotImplemented(serviceName, "Marking notifications as read"))

		router.AuthenticatedFunc("POST /api/v1/notifications/devices",
			httpx.NotImplemented(serviceName, "Registering a push device"))
	}
	servicekit.MustRun(options)
}
