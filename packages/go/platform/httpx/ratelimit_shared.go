package httpx

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

// sharedCounter meters clients in a store every instance shares. It answers
// "how many requests has this client made in the current window", across all
// instances at once.
type sharedCounter interface {
	// Increment adds one request to key's count for a window of ttl and returns
	// the new count.
	Increment(ctx context.Context, key string, ttl time.Duration) (int64, error)
}

// sharedTimeout bounds the extra hop. The shared check fails open (the
// in-process bucket has already passed), so a slow or absent store costs at most
// this much latency and never rejects valid traffic.
const sharedTimeout = 300 * time.Millisecond

// upstashCounter speaks Upstash's Redis REST API: one pipelined INCR + EXPIRE
// per request, so a key always expires even if this process dies mid-window.
type upstashCounter struct {
	url    string
	token  string
	client *http.Client
}

func newUpstashCounter(cfg config.SharedRateLimit) *upstashCounter {
	return &upstashCounter{
		url:    cfg.RESTURL,
		token:  cfg.RESTToken,
		client: &http.Client{Timeout: sharedTimeout},
	}
}

func (u *upstashCounter) Increment(ctx context.Context, key string, ttl time.Duration) (int64, error) {
	body, err := json.Marshal([][]string{
		{"INCR", key},
		{"EXPIRE", key, strconv.Itoa(int(ttl.Seconds()))},
	})
	if err != nil {
		return 0, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, u.url+"/pipeline", bytes.NewReader(body))
	if err != nil {
		return 0, err
	}
	req.Header.Set("Authorization", "Bearer "+u.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := u.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return 0, fmt.Errorf("upstash: status %d", resp.StatusCode)
	}
	var results []struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&results); err != nil {
		return 0, fmt.Errorf("upstash: %w", err)
	}
	if len(results) == 0 || results[0].Error != "" {
		return 0, fmt.Errorf("upstash: INCR failed")
	}
	var count int64
	if err := json.Unmarshal(results[0].Result, &count); err != nil {
		return 0, fmt.Errorf("upstash: %w", err)
	}
	return count, nil
}

// sharedAllow reports whether client is still inside its shared per-minute
// budget. It uses fixed one-minute windows: simple, one round trip, and the
// in-process token bucket in front of it already smooths bursts.
func (l *RateLimiter) sharedAllow(client string) bool {
	if l.shared == nil || l.perMinute <= 0 {
		return true
	}
	window := l.now().Unix() / 60
	key := fmt.Sprintf("rl:%s:%s:%d", l.namespace, client, window)
	ctx, cancel := context.WithTimeout(context.Background(), sharedTimeout)
	defer cancel()
	count, err := l.shared.Increment(ctx, key, 2*time.Minute)
	if err != nil {
		// Fail open: the in-process limit still holds, and an outage of the
		// store must never become an outage of the API.
		return true
	}
	return count <= int64(l.perMinute)
}
