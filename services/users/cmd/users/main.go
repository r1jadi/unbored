// Command users runs the Users service locally.
//
// It is the developer's entrypoint — `go run ./users/cmd/users` from `services/`.
// In production the service is mounted in services/cmd/standalone with every
// other route group (docs/deployment/production.md). The legacy Vercel
// entrypoint, services/cmd/api, is the same one line of
// `servicekit.MustRun(users.Options())`, so the wirings cannot drift.
//
// See services/users/users.go for the routes.
package main

import (
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/users"
)

func main() {
	servicekit.MustRun(users.Options())
}
