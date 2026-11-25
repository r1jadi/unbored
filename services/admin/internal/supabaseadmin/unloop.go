package supabaseadmin

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// UnloopBucket is the public storage bucket that holds Unloop videos and their
// thumbnails (supabase/migrations/20270123120000_unloop.sql).
const UnloopBucket = "unloop"

// UnloopVideo is one video as the admin console sees it, drafts included.
type UnloopVideo struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Category        string     `json:"category"`
	VideoPath       string     `json:"video_path"`
	ThumbnailPath   *string    `json:"thumbnail_path"`
	DurationSeconds *float64   `json:"duration_seconds"`
	Status          string     `json:"status"`
	CreatedBy       *string    `json:"created_by"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
	PublishedAt     *time.Time `json:"published_at"`
	Likes           int64      `json:"likes"`
	Saves           int64      `json:"saves"`
}

// UnloopDraft is what an administrator writes: a new video, or a change to one.
type UnloopDraft struct {
	Title           string
	Description     string
	Category        string
	VideoPath       string
	ThumbnailPath   string
	DurationSeconds *float64
	Status          string
}

// UnloopSaved is what a save answers with. The previous paths are the files the
// row pointed at before, so a replaced file can be removed.
type UnloopSaved struct {
	ID                    string  `json:"id"`
	Status                string  `json:"status"`
	PreviousVideoPath     *string `json:"previousVideoPath"`
	PreviousThumbnailPath *string `json:"previousThumbnailPath"`
}

// UnloopDeleted is what a delete answers with: the files the row pointed at.
type UnloopDeleted struct {
	ID            string  `json:"id"`
	VideoPath     string  `json:"videoPath"`
	ThumbnailPath *string `json:"thumbnailPath"`
}

// UnloopVideos reads one page of videos, newest change first. An empty status is
// every status.
func (c *Client) UnloopVideos(ctx context.Context, token, actor, status string, page Page) ([]UnloopVideo, error) {
	payload := map[string]any{
		"p_status": nullable(status),
		"p_limit":  page.Limit + 1,
		"p_offset": page.Offset,
	}
	var rows []UnloopVideo
	if err := c.invoke(ctx, "unloop-videos", "admin_unloop_videos", "admin_unloop_videos_svc", payload, token, actor, &rows); err != nil {
		return nil, err
	}
	return rows, nil
}

// SaveUnloopVideo creates a video (id empty) or changes one. A file the change
// replaced is removed from storage, best effort.
func (c *Client) SaveUnloopVideo(ctx context.Context, token, actor, id string, draft UnloopDraft) (UnloopSaved, error) {
	payload := map[string]any{
		"p_id":               nullable(id),
		"p_title":            draft.Title,
		"p_description":      draft.Description,
		"p_category":         draft.Category,
		"p_video_path":       draft.VideoPath,
		"p_thumbnail_path":   nullable(draft.ThumbnailPath),
		"p_duration_seconds": draft.DurationSeconds,
		"p_status":           draft.Status,
	}
	var saved UnloopSaved
	if err := c.invoke(ctx, "unloop-save", "admin_unloop_save", "admin_unloop_save_svc", payload, token, actor, &saved); err != nil {
		return UnloopSaved{}, err
	}
	if saved.PreviousVideoPath != nil && *saved.PreviousVideoPath != draft.VideoPath {
		c.deleteUnloopObject(ctx, token, *saved.PreviousVideoPath)
	}
	if saved.PreviousThumbnailPath != nil && *saved.PreviousThumbnailPath != draft.ThumbnailPath {
		c.deleteUnloopObject(ctx, token, *saved.PreviousThumbnailPath)
	}
	return saved, nil
}

// DeleteUnloopVideo deletes a video with its likes and saves, then its files.
func (c *Client) DeleteUnloopVideo(ctx context.Context, token, actor, id string) (UnloopDeleted, error) {
	var deleted UnloopDeleted
	if err := c.invoke(ctx, "unloop-delete", "admin_unloop_delete", "admin_unloop_delete_svc",
		map[string]any{"p_id": id}, token, actor, &deleted); err != nil {
		return UnloopDeleted{}, err
	}
	c.deleteUnloopObject(ctx, token, deleted.VideoPath)
	if deleted.ThumbnailPath != nil {
		c.deleteUnloopObject(ctx, token, *deleted.ThumbnailPath)
	}
	return deleted, nil
}

// SignUnloopUpload mints a one-time URL the browser uploads one file to, at a path
// the service chose. Large files go straight to storage this way instead of
// through the API's request-size limit.
//
// With the secret configured the URL is minted as the service role; without it,
// as the caller, and storage's own policy (an administrator row) decides.
func (c *Client) SignUnloopUpload(ctx context.Context, token, path string) (string, error) {
	const op = "unloop-sign-upload"
	apiKey, bearer := c.apiKey, token
	if c.secret != "" {
		apiKey, bearer = c.secret, c.secret
	}
	if bearer == "" {
		return "", &Error{Op: op, cause: errors.New("no credential")}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost,
		c.baseURL+"/storage/v1/object/upload/sign/"+UnloopBucket+"/"+escapePath(path), bytes.NewReader([]byte("{}")))
	if err != nil {
		return "", &Error{Op: op, cause: err}
	}
	request.Header.Set("apikey", apiKey)
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	request.Header.Set("X-Client-Info", "unbored-admin-service")

	response, err := c.http.Do(request)
	if err != nil {
		return "", &Error{Op: op, cause: err}
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", &Error{Op: op, Status: response.StatusCode}
	}
	var signed struct {
		URL string `json:"url"`
	}
	if err := decodeJSON(response.Body, &signed); err != nil {
		return "", &Error{Op: op, Status: response.StatusCode, cause: err}
	}
	// Storage answers a path relative to its own root, with the token in the query.
	if !strings.HasPrefix(signed.URL, "/object/upload/sign/"+UnloopBucket+"/") || !strings.Contains(signed.URL, "token=") {
		return "", &Error{Op: op, Status: response.StatusCode, cause: errors.New("unexpected signed upload url")}
	}
	return c.baseURL + "/storage/v1" + signed.URL, nil
}

// deleteUnloopObject removes one file from the Unloop bucket, best effort: the
// row is already gone or changed, and a failure only leaves an unreferenced file.
func (c *Client) deleteUnloopObject(ctx context.Context, token, path string) {
	if path == "" {
		return
	}
	apiKey, bearer := c.apiKey, token
	if c.secret != "" {
		apiKey, bearer = c.secret, c.secret
	}
	if bearer == "" {
		return
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodDelete,
		c.baseURL+"/storage/v1/object/"+UnloopBucket+"/"+escapePath(path), nil)
	if err != nil {
		return
	}
	request.Header.Set("apikey", apiKey)
	request.Header.Set("Authorization", "Bearer "+bearer)
	request.Header.Set("X-Client-Info", "unbored-admin-service")
	if response, err := c.http.Do(request); err == nil {
		_ = response.Body.Close()
	}
}

func escapePath(path string) string {
	segments := strings.Split(path, "/")
	for i, segment := range segments {
		segments[i] = url.PathEscape(segment)
	}
	return strings.Join(segments, "/")
}
