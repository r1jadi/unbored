package proxy

import (
	"net/http"

	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

// cdnCacheWriter turns a service's "this answer is the same for every guest" marker
// into the headers Vercel's CDN acts on, at the moment the response starts.
//
// It has to happen here. A service sits behind its own Vercel hop, which consumes
// `Vercel-CDN-Cache-Control`, so a value set by the service never reaches the CDN in
// front of this gateway. It runs at WriteHeader because this gateway's own security
// middleware has already set `Cache-Control: no-store` on the response, and the CDN
// won't keep an answer carrying that. Browsers are told to check again every time.
//
// The marker never leaves the gateway, and only a successful read by a guest can be
// kept: a request with a token may have been answered with the caller's own data.
type cdnCacheWriter struct {
	http.ResponseWriter
	guestRead bool
	done      bool
}

func newCDNCacheWriter(w http.ResponseWriter, r *http.Request) *cdnCacheWriter {
	return &cdnCacheWriter{
		ResponseWriter: w,
		guestRead:      r.Method == http.MethodGet && r.Header.Get("Authorization") == "",
	}
}

func (w *cdnCacheWriter) WriteHeader(status int) {
	if !w.done {
		w.done = true
		h := w.Header()
		policy := h.Get(apiroutes.CDNCachePolicyHeader)
		h.Del(apiroutes.CDNCachePolicyHeader)
		if policy != "" && w.guestRead && status == http.StatusOK {
			h.Set("Vercel-CDN-Cache-Control", policy)
			h.Set("Cache-Control", "public, max-age=0, must-revalidate")
		}
	}
	w.ResponseWriter.WriteHeader(status)
}

func (w *cdnCacheWriter) Write(body []byte) (int, error) {
	if !w.done {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(body)
}

// Unwrap lets the reverse proxy reach the underlying writer's flushing.
func (w *cdnCacheWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
