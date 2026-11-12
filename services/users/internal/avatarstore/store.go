// Package avatarstore moves a profile picture from the private holding bucket to
// the public one, and points the profile at it.
//
// It is the only code in the users service that holds the server-only secret key
// (`SUPABASE_SECRET_KEY`). It needs it because, since
// `20261231120100_avatar_screening.sql`, players can no longer write into the
// public `avatars` bucket or set `profiles.avatar_path` to a file: only a picture
// that passed the screening is published, and only by this service. Every path
// it touches is built by the handler from the verified token's user id, never
// taken from a request as-is.
package avatarstore

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

const (
	// HoldingBucket is private: a picture waits there until it is screened.
	HoldingBucket = "avatar-uploads"
	// PublicBucket serves the pictures players see.
	PublicBucket = "avatars"
	// MaxPictureBytes mirrors both buckets' file_size_limit.
	MaxPictureBytes = 2 * 1024 * 1024
)

// ErrNotFound is a holding-bucket object that does not exist.
var ErrNotFound = errors.New("the uploaded picture was not found")

// Store is what the avatar handler needs. An interface, so the handler is tested
// without a network.
type Store interface {
	// Fetch reads a picture from the holding bucket, with its content type.
	Fetch(ctx context.Context, path string) ([]byte, string, error)
	// Publish writes a picture into the public bucket.
	Publish(ctx context.Context, path string, picture []byte, contentType string) error
	// SetAvatarPath points a profile at a published picture.
	SetAvatarPath(ctx context.Context, userID, path string) error
	// Remove deletes an object from a bucket. A missing object is not an error.
	Remove(ctx context.Context, bucket, path string) error
}

// Client is the Supabase-backed Store.
type Client struct {
	baseURL string
	secret  string
	http    *http.Client
}

// New builds the client. It needs the project URL and the secret key.
func New(cfg *config.Config) (*Client, error) {
	secret := strings.TrimSpace(cfg.Supabase.SecretKey)
	if strings.TrimSpace(cfg.Supabase.ProjectURL) == "" || secret == "" {
		return nil, errors.New("SUPABASE_URL and SUPABASE_SECRET_KEY are required to publish profile pictures")
	}
	return &Client{
		baseURL: strings.TrimRight(cfg.Supabase.ProjectURL, "/"),
		secret:  secret,
		http:    &http.Client{Timeout: 20 * time.Second},
	}, nil
}

// WithHTTP swaps the transport: tests point it at a local server.
func (c *Client) WithHTTP(baseURL string, httpClient *http.Client) *Client {
	copied := *c
	copied.baseURL = strings.TrimRight(baseURL, "/")
	copied.http = httpClient
	return &copied
}

// Error is a failed call: the operation and the status Supabase answered with.
// It never carries a response body.
type Error struct {
	Op     string
	Status int
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("avatar store %s: request failed (%v)", e.Op, e.cause)
	}
	return fmt.Sprintf("avatar store %s: status %d", e.Op, e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

func objectURL(base, bucket, path string) string {
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return base + "/storage/v1/object/" + bucket + "/" + strings.Join(segments, "/")
}

func (c *Client) send(ctx context.Context, op, method, target string, body io.Reader, headers map[string]string) (*http.Response, error) {
	request, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", c.secret)
	request.Header.Set("Authorization", "Bearer "+c.secret)
	request.Header.Set("X-Client-Info", "unbored-users-service")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, &Error{Op: op, cause: err}
	}
	return response, nil
}

// Fetch reads a picture from the holding bucket.
func (c *Client) Fetch(ctx context.Context, path string) ([]byte, string, error) {
	response, err := c.send(ctx, "fetch", http.MethodGet, objectURL(c.baseURL, HoldingBucket, path), nil, nil)
	if err != nil {
		return nil, "", err
	}
	defer response.Body.Close()
	// Storage answers a missing object with 400 or 404, depending on version.
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusBadRequest {
		return nil, "", ErrNotFound
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, "", &Error{Op: "fetch", Status: response.StatusCode}
	}
	// One byte over the limit is enough to know it is too big.
	picture, err := io.ReadAll(io.LimitReader(response.Body, MaxPictureBytes+1))
	if err != nil {
		return nil, "", &Error{Op: "fetch", Status: response.StatusCode, cause: err}
	}
	contentType := strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0])
	return picture, contentType, nil
}

// Publish writes a picture into the public bucket. Paths are fresh per upload, so
// it never overwrites.
func (c *Client) Publish(ctx context.Context, path string, picture []byte, contentType string) error {
	response, err := c.send(ctx, "publish", http.MethodPost, objectURL(c.baseURL, PublicBucket, path),
		bytes.NewReader(picture), map[string]string{
			"Content-Type":  contentType,
			"x-upsert":      "false",
			"cache-control": "max-age=3600",
		})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &Error{Op: "publish", Status: response.StatusCode}
	}
	return nil
}

// SetAvatarPath points a profile at a published picture, as service_role: the
// one role the `profiles_avatar_path_server_only` trigger lets set a path.
func (c *Client) SetAvatarPath(ctx context.Context, userID, path string) error {
	target := c.baseURL + "/rest/v1/profiles?id=eq." + url.QueryEscape(userID)
	body := fmt.Sprintf(`{"avatar_path":%q}`, path)
	response, err := c.send(ctx, "set-avatar", http.MethodPatch, target, strings.NewReader(body), map[string]string{
		"Content-Type": "application/json",
		"Prefer":       "return=minimal",
	})
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &Error{Op: "set-avatar", Status: response.StatusCode}
	}
	return nil
}

// Remove deletes one object. A missing object is already the goal.
func (c *Client) Remove(ctx context.Context, bucket, path string) error {
	response, err := c.send(ctx, "remove", http.MethodDelete, objectURL(c.baseURL, bucket, path), nil, nil)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusBadRequest {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return &Error{Op: "remove", Status: response.StatusCode}
	}
	return nil
}
