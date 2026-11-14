// Package apiroutes is the single source of truth for which service owns which
// `/api/v1` path prefix. The local gateway routes by this table, the production
// API process (services/cmd/standalone) answers 503 from it for groups nothing
// serves (Unavailable), tests assert it and docs/architecture/api.md documents it.
//
// Adding a group here does not expose it: the gateway only forwards a group when
// its UPSTREAM_<SERVICE>_URL is configured, and in production the group answers
// 503 until a package registers its routes.
package apiroutes

// Group maps a public API prefix to the service that owns it.
type Group struct {
	Prefix  string
	Service string
}

// Version is the only API version served today.
const Version = "v1"

// CDNCachePolicyHeader is how a handler marks an answer as the same for every
// guest, and how long the CDN may keep it. services/internal/cdncache turns it into
// the CDN's headers and removes it, so it never leaves the service.
const CDNCachePolicyHeader = "X-Unbored-Cdn-Cache"

// BasePath is the versioned API root.
const BasePath = "/api/" + Version

// Groups lists every service-owned API prefix, longest-lived first.
func Groups() []Group {
	return []Group{
		{Prefix: BasePath + "/auth", Service: "auth"},
		{Prefix: BasePath + "/users", Service: "users"},
		{Prefix: BasePath + "/games", Service: "games"},
		// Categories are the catalogue's own reference data, served by the games
		// service so a category page and its game list come from one place (and
		// one database query for the counts).
		{Prefix: BasePath + "/categories", Service: "games"},
		// Sessions are served by the `game-sessions` package, mounted alongside
		// the catalogue (in the games process locally, in the single API process
		// in production). The prefix is listed under the service that answers it
		// locally, so the routing (the local gateway, apiroutes.Unavailable)
		// cannot drift from what runs.
		{Prefix: BasePath + "/sessions", Service: "games"},
		{Prefix: BasePath + "/scores", Service: "scores"},
		{Prefix: BasePath + "/leaderboards", Service: "leaderboards"},
		{Prefix: BasePath + "/feed", Service: "feed"},
		{Prefix: BasePath + "/recommendations", Service: "recommendations"},
		{Prefix: BasePath + "/comments", Service: "social"},
		{Prefix: BasePath + "/follows", Service: "social"},
		{Prefix: BasePath + "/likes", Service: "social"},
		{Prefix: BasePath + "/notifications", Service: "notifications"},
		{Prefix: BasePath + "/search", Service: "search"},
		{Prefix: BasePath + "/moderation", Service: "moderation"},
		{Prefix: BasePath + "/analytics", Service: "analytics"},
		// The admin group is served by the `admin` package, mounted beside the
		// catalogue like the play sessions. The prefix names the service that
		// answers it, so the routing cannot drift from what runs.
		{Prefix: BasePath + "/admin", Service: "games"},
		// The game-release digest is triggered by the daily cron (GitHub Actions,
		// .github/workflows/cron.yml), not a user. It is served by the
		// notifications package mounted beside the catalogue (that process already
		// holds the secret key) and authenticates the
		// caller with CRON_SECRET. It lives under its own prefix so it cannot be
		// mistaken for a staff route, and the gateway forwards it through the
		// existing games upstream.
		{Prefix: BasePath + "/cron", Service: "games"},
	}
}

// Services lists every backend service in the platform. The Go workspace, CI
// matrix and docs derive from this list.
func Services() []string {
	return []string{
		"gateway", "auth", "users", "games", "game-sessions", "scores",
		"leaderboards", "feed", "recommendations", "social", "notifications",
		"search", "moderation", "analytics", "admin",
	}
}
