module github.com/r1jadi/unbored/services

go 1.27

require (
	github.com/SherClockHolmes/webpush-go v1.4.0
	github.com/golang-jwt/jwt/v5 v5.3.1
	github.com/r1jadi/unbored/packages/go/platform v0.0.0
)

require golang.org/x/crypto v0.31.0 // indirect

// The platform library is not published to a module proxy; it is consumed from
// this repository. Once it is versioned, drop this directive and pin a real
// version — see docs/decisions/0001-go-module-strategy.md.
replace github.com/r1jadi/unbored/packages/go/platform => ../packages/go/platform
