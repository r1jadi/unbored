// Command game-sessions owns play sessions.
//
// A session is the server's record of one play attempt: the database chooses the
// seed and keeps the timeline, and the only way a score comes into existence is a
// finished run being replayed against the rules its session was issued under.
//
// This binary is the service on its own, for local development. In production
// the same routes are mounted in services/cmd/standalone with every other route
// group — see docs/deployment/production.md.
package main

import (
	"github.com/r1jadi/unbored/services/game-sessions"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(gamesessions.Options())
}
