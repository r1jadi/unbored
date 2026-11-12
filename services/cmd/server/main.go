// Command server is the Vercel entrypoint for the Auth service.
//
// Vercel's Go framework preset detects exactly three entrypoints — main.go,
// cmd/api/main.go and cmd/server/main.go — and the Users service owns
// cmd/api/main.go and the games deployment main.go. `cmd/server` is the
// remaining detected name, so the Auth service mounts here.
//
// The service is defined in services/auth, and this file only names it. There is
// no second implementation to drift — `go run ./auth/cmd/auth` and this
// deployment entrypoint both call servicekit.MustRun(auth.Options()).
//
// See docs/deployment/vercel.md for the routing, and services/auth/README.md for
// the endpoints and the environment it needs.
package main

import (
	"github.com/r1jadi/unbored/services/auth"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(auth.Options())
}
