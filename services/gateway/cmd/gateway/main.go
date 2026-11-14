// Command gateway is the long-running API gateway process: one process, no
// database credentials, no service role key.
//
// The wiring lives in the gateway package; this file only fixes the process
// model. It listens on
// HTTP_ADDR (or PORT when the platform injects one) and shuts down gracefully on
// a termination signal.
package main

import (
	"github.com/r1jadi/unbored/services/gateway"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

func main() {
	servicekit.MustRun(gateway.Options())
}
