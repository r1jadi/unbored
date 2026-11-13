// Package apicache keeps the public catalogue reads — the game list, one game,
// the categories — in memory for a short while.
//
// Every one of those responses is the same for every anonymous visitor, and
// each costs one or more round trips to the database. Serving them from memory
// for a minute turns most page loads into a single in-process lookup, and the
// Cache-Control header lets the browser reuse them across navigations too.
//
// Only anonymous GETs with a 200 answer are stored: a request carrying a token
// (the "following" feed, a viewer-specific view) always reaches the handler.
package apicache

import (
	"bytes"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/httpx"
)

// BrowserCacheControl is what a cached-eligible response tells the browser:
// reuse for 30 seconds, then serve stale while revalidating for 5 minutes.
const BrowserCacheControl = "public, max-age=30, stale-while-revalidate=300"

const maxEntries = 1000

type entry struct {
	status      int
	contentType string
	body        []byte
	expires     time.Time
}

// Cache is a small TTL cache of whole responses keyed by path and query.
type Cache struct {
	ttl     time.Duration
	now     func() time.Time
	mu      sync.RWMutex
	entries map[string]entry
}

// New builds a cache whose entries live for ttl.
func New(ttl time.Duration) *Cache {
	return &Cache{ttl: ttl, now: time.Now, entries: make(map[string]entry)}
}

// Cacheable reports whether a request is one of the public catalogue reads.
func Cacheable(r *http.Request) bool {
	if r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
		return false
	}
	switch p := r.URL.Path; {
	case p == "/api/v1/games", p == "/api/v1/categories":
		return true
	case strings.HasPrefix(p, "/api/v1/games/"):
		slug := strings.TrimPrefix(p, "/api/v1/games/")
		return slug != "" && slug != "following" && !strings.Contains(slug, "/")
	}
	return false
}

// Middleware serves cacheable requests from memory and stores fresh answers.
func (c *Cache) Middleware() httpx.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if !Cacheable(r) {
				next.ServeHTTP(w, r)
				return
			}
			key := r.URL.Path + "?" + r.URL.RawQuery
			now := c.now()

			c.mu.RLock()
			hit, ok := c.entries[key]
			c.mu.RUnlock()
			if ok && now.Before(hit.expires) {
				write(w, hit, "HIT")
				return
			}

			rec := &recorder{header: http.Header{}, status: http.StatusOK}
			next.ServeHTTP(rec, r)

			fresh := entry{
				status:      rec.status,
				contentType: rec.header.Get("Content-Type"),
				body:        rec.body.Bytes(),
				expires:     now.Add(c.ttl),
			}
			if rec.status != http.StatusOK {
				// Errors pass through untouched, with the handler's own headers.
				for k, v := range rec.header {
					w.Header()[k] = v
				}
				w.WriteHeader(rec.status)
				_, _ = w.Write(fresh.body)
				return
			}
			c.mu.Lock()
			if len(c.entries) >= maxEntries {
				for k, e := range c.entries {
					if !now.Before(e.expires) {
						delete(c.entries, k)
					}
				}
				if len(c.entries) >= maxEntries {
					c.entries = make(map[string]entry)
				}
			}
			c.entries[key] = fresh
			c.mu.Unlock()
			write(w, fresh, "MISS")
		})
	}
}

func write(w http.ResponseWriter, e entry, state string) {
	h := w.Header()
	if e.contentType != "" {
		h.Set("Content-Type", e.contentType)
	}
	h.Set("Cache-Control", BrowserCacheControl)
	h.Set("X-Cache", state)
	w.WriteHeader(e.status)
	_, _ = w.Write(e.body)
}

type recorder struct {
	header http.Header
	status int
	body   bytes.Buffer
	wrote  bool
}

func (r *recorder) Header() http.Header { return r.header }

func (r *recorder) WriteHeader(status int) {
	if !r.wrote {
		r.status = status
		r.wrote = true
	}
}

func (r *recorder) Write(b []byte) (int, error) {
	r.wrote = true
	return r.body.Write(b)
}
