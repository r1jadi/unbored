// Command api is the former Vercel entrypoint for the Users service.
//
// Legacy: no longer deployed. Production runs every route group in one process,
// services/cmd/standalone, on Render (docs/decisions/0016-cloudflare-and-render-hosting.md).
// This entrypoint is kept, and built in CI, so a return to Vercel stays a config
// change.
//
// The name is not a description: Vercel's Go framework preset detects exactly
// three entrypoints at a service root — `main.go`, `cmd/api/main.go` and
// `cmd/server/main.go` — and a service that wants the preset has to live in one
// of them. `cmd/server` is the auth service's and `main.go` the games
// deployment's, so `cmd/api` is the one the Users service takes.
//
// This is not a second implementation of anything: the body is the same one line
// `services/users/cmd/users` runs, so `go run ./users/cmd/users`, the local
// binary and the deployment all call `servicekit.MustRun(users.Options())`.
//
// See docs/deployment/archive/vercel.md for the routing and services/users/README.md for
// the endpoints.
package main

import (
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/users"
)

func main() {
	servicekit.MustRun(users.Options())
}
