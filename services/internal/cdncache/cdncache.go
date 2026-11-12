// Package cdncache turns a service's "this answer is the same for every guest"
// marker into the headers Vercel's CDN acts on.
//
// A handler marks a response with apiroutes.CDNCachePolicyHeader and a
// `Cache-Control`-style policy (`s-maxage=60, stale-while-revalidate=300`). This
// middleware, installed in the service that owns those handlers, rewrites the
// marker at the moment the response starts:
//
//   - `Vercel-CDN-Cache-Control: <policy>` — read by Vercel's CDN, then removed
//     before the response reaches the browser.
//   - `Cache-Control: public, max-age=0, must-revalidate` — the security
//     middleware has already set `no-store`, and the CDN won't keep an answer
//     carrying that. Browsers are still told to check again every time.
//
// Only a successful GET by a guest can be kept: a request with a token may have
// been answered with the caller's own data. The marker never leaves the service,
// whether or not it was applied.
//
// This used to live in the gateway, because a service behind the gateway sat
// behind its own Vercel hop that consumed the CDN header. Since the services are
// routed to directly (docs/decisions/0015-direct-service-routing.md), the service
// is the hop the CDN sees, so the service sets the header itself.
package cdncache

import (
	"net/http"

	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

// HeaderName is the CDN-only cache header Vercel reads and strips.
const HeaderName = "Vercel-CDN-Cache-Control"

// BrowserCacheControl replaces the API's `no-store` baseline on a cacheable
// answer: the CDN may keep it, the browser revalidates on every use.
const BrowserCacheControl = "public, max-age=0, must-revalidate"

// Middleware applies a handler's CDN marker to the response.
func Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(newWriter(w, r), r)
	})
}

type writer struct {
	http.ResponseWriter
	guestRead bool
	done      bool
}

func newWriter(w http.ResponseWriter, r *http.Request) *writer {
	return &writer{
		ResponseWriter: w,
		guestRead:      r.Method == http.MethodGet && r.Header.Get("Authorization") == "",
	}
}

func (w *writer) WriteHeader(status int) {
	if !w.done {
		w.done = true
		h := w.Header()
		policy := h.Get(apiroutes.CDNCachePolicyHeader)
		h.Del(apiroutes.CDNCachePolicyHeader)
		if policy != "" && w.guestRead && status == http.StatusOK {
			h.Set(HeaderName, policy)
			h.Set("Cache-Control", BrowserCacheControl)
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *writer) Write(body []byte) (int, error) {
	if !w.done {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (w *writer) Unwrap() http.ResponseWriter { return w.ResponseWriter }
