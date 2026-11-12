package apiroutes

import (
	"net/http"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/packages/go/platform/version"
)

// UnavailableMessage is the 503 answer for a route group nothing in this
// environment serves yet. The web app treats it as "not here yet", not as an
// outage.
const UnavailableMessage = "This API is not available in this environment yet."

// RegisterVersion mounts `GET /api/v1`: which API version, build and commit this
// deployment speaks, with no authentication and no dependency.
func RegisterVersion(router *httpx.Router) {
	router.PublicFunc("GET "+BasePath, func(w http.ResponseWriter, r *http.Request) {
		httpx.WriteJSON(w, r, http.StatusOK, map[string]any{
			"apiVersion": Version,
			"version":    version.Version,
			"commit":     version.Commit,
		})
	})
}

// Unavailable answers 503 for a request to a route group owned by a service this
// process does not run, so a group that has no deployment yet fails loudly
// rather than as a generic 404. served names the services this process runs;
// their groups pass through untouched, as does everything outside the groups.
func Unavailable(served ...string) httpx.Middleware {
	runs := make(map[string]bool, len(served))
	for _, name := range served {
		runs[name] = true
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if group, ok := GroupFor(r.URL.Path); ok && !runs[group.Service] {
				httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, UnavailableMessage))
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// GroupFor returns the route group a path belongs to: the group whose prefix is
// the path itself or a whole leading segment of it (`/api/v1/games/x`, not
// `/api/v1/gamesx`). The longest prefix wins.
func GroupFor(path string) (Group, bool) {
	var best Group
	found := false
	for _, group := range Groups() {
		if path != group.Prefix && !strings.HasPrefix(path, group.Prefix+"/") {
			continue
		}
		if !found || len(group.Prefix) > len(best.Prefix) {
			best, found = group, true
		}
	}
	return best, found
}
