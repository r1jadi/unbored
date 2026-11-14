// Command games runs the Games service locally.
//
// It is the developer's entrypoint — `go run ./games/cmd/games` from
// `services/`. In production the service is mounted in services/cmd/standalone
// with every other route group (docs/deployment/production.md); the legacy
// Vercel entrypoint, services/main.go, mounts the same package.
//
// See services/games/games.go for the routes.
package main

import (
	"github.com/r1jadi/unbored/services/games"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(games.Options())
}
