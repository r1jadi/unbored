// Command users runs the Users service locally.
//
// It is the developer's entrypoint — `go run ./users/cmd/users` from `services/`
// — and the deployment entrypoint is services/cmd/api, because Vercel's Go
// framework preset only recognises `main.go`, `cmd/api/main.go` and
// `cmd/server/main.go` at the service root, and the other two names are already
// spoken for (auth owns `cmd/server`, the games deployment `main.go`). Both
// files are one line of
// `servicekit.MustRun(users.Options())`, so the local binary and the deployment
// cannot drift into different wiring.
//
// See services/users/users.go for the routes and docs/deployment/vercel.md for
// the topology.
package main

import (
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/users"
)

func main() {
	servicekit.MustRun(users.Options())
}
