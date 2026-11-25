package admin

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

// Unloop: the short videos administrators publish. Everyone watches them; only an
// allowlisted administrator writes them.
//
//   - GET    /admin/unloop/videos             lists every video, drafts included.
//   - POST   /admin/unloop/videos             creates one (a draft, or published).
//   - PATCH  /admin/unloop/videos/{videoID}   changes one, including its status.
//   - DELETE /admin/unloop/videos/{videoID}   deletes one with its likes and files.
//   - POST   /admin/unloop/uploads            mints a one-time upload URL for a file.
//
// Every route is on the admin tier and re-checks it, because with the secret
// configured the database would see the bridge's administrator for a moderator too.
const (
	UnloopVideosPath  = "/api/v1/admin/unloop/videos"
	UnloopVideoPath   = "/api/v1/admin/unloop/videos/{videoID}"
	UnloopUploadsPath = "/api/v1/admin/unloop/uploads"

	maxUnloopDescriptionRunes = 500
	maxUnloopSeconds          = 600
)

var (
	unloopCategories = []string{"highlights", "how-to", "speedruns", "brain-food", "behind-the-scenes", "just-for-fun"}
	unloopStatuses   = []string{"draft", "published"}

	// The same shapes the database checks. The service mints the names, so a
	// path that doesn't match one was not minted here.
	unloopVideoPath     = regexp.MustCompile(`^videos/[a-z0-9-]{36}\.(mp4|webm|mov)$`)
	unloopThumbnailPath = regexp.MustCompile(`^thumbnails/[a-z0-9-]{36}\.(jpg|png|webp)$`)

	unloopVideoTypes = map[string]string{"video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov"}
	unloopImageTypes = map[string]string{"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
)

type unloopVideoView struct {
	ID              string     `json:"id"`
	Title           string     `json:"title"`
	Description     string     `json:"description"`
	Category        string     `json:"category"`
	VideoPath       string     `json:"videoPath"`
	ThumbnailPath   *string    `json:"thumbnailPath"`
	DurationSeconds *float64   `json:"durationSeconds"`
	Status          string     `json:"status"`
	CreatedBy       *string    `json:"createdByUsername"`
	CreatedAt       time.Time  `json:"createdAt"`
	UpdatedAt       time.Time  `json:"updatedAt"`
	PublishedAt     *time.Time `json:"publishedAt"`
	Likes           int64      `json:"likes"`
	Saves           int64      `json:"saves"`
}

type unloopVideoRequest struct {
	Title           string   `json:"title"`
	Description     string   `json:"description"`
	Category        string   `json:"category"`
	VideoPath       string   `json:"videoPath"`
	ThumbnailPath   *string  `json:"thumbnailPath"`
	DurationSeconds *float64 `json:"durationSeconds"`
	Status          string   `json:"status"`
}

type unloopUploadRequest struct {
	Kind        string `json:"kind"`
	ContentType string `json:"contentType"`
}

func (s *service) registerUnloop(router *httpx.Router) {
	router.AdminFunc("GET "+UnloopVideosPath, s.staff(s.listUnloopVideos))
	router.AdminFunc("POST "+UnloopVideosPath, s.staff(s.createUnloopVideo))
	router.AdminFunc("PATCH "+UnloopVideoPath, s.staff(s.updateUnloopVideo))
	router.AdminFunc("DELETE "+UnloopVideoPath, s.staff(s.deleteUnloopVideo))
	router.AdminFunc("POST "+UnloopUploadsPath, s.staff(s.signUnloopUpload))
}

func (s *service) listUnloopVideos(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	page, ok := s.page(w, r)
	if !ok {
		return
	}
	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !contains(unloopStatuses, status) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"status must be draft or published.", apierr.Detail{Field: "status", Rule: "unsupported"}))
		return
	}
	rows, err := s.backend.UnloopVideos(r.Context(), s.token(r), s.actor(r), status, page)
	if err != nil {
		s.dataFailure(w, r, "list Unloop videos", err)
		return
	}
	hasMore := len(rows) > page.Limit
	if hasMore {
		rows = rows[:page.Limit]
	}
	items := make([]unloopVideoView, 0, len(rows))
	for _, row := range rows {
		items = append(items, unloopVideoView{
			ID: row.ID, Title: row.Title, Description: row.Description, Category: row.Category,
			VideoPath: row.VideoPath, ThumbnailPath: row.ThumbnailPath,
			DurationSeconds: row.DurationSeconds, Status: row.Status, CreatedBy: row.CreatedBy,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt, PublishedAt: row.PublishedAt,
			Likes: row.Likes, Saves: row.Saves,
		})
	}
	s.writePage(w, r, items, hasMore)
}

func (s *service) createUnloopVideo(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	draft, ok := s.unloopBody(w, r)
	if !ok {
		return
	}
	saved, err := s.backend.SaveUnloopVideo(r.Context(), s.token(r), s.actor(r), "", draft)
	if err != nil {
		s.unloopFailure(w, r, "publish an Unloop video", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusCreated, unloopChangeView{ID: saved.ID, Status: saved.Status})
}

func (s *service) updateUnloopVideo(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	id, ok := s.pathID(w, r, "videoID", "video")
	if !ok {
		return
	}
	draft, ok := s.unloopBody(w, r)
	if !ok {
		return
	}
	saved, err := s.backend.SaveUnloopVideo(r.Context(), s.token(r), s.actor(r), strings.ToLower(id), draft)
	if err != nil {
		s.unloopFailure(w, r, "change an Unloop video", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, unloopChangeView{ID: saved.ID, Status: saved.Status})
}

func (s *service) deleteUnloopVideo(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	id, ok := s.pathID(w, r, "videoID", "video")
	if !ok {
		return
	}
	deleted, err := s.backend.DeleteUnloopVideo(r.Context(), s.token(r), s.actor(r), strings.ToLower(id))
	if err != nil {
		s.moderationFailure(w, r, "delete an Unloop video", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, unloopChangeView{ID: deleted.ID})
}

func (s *service) signUnloopUpload(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	var body unloopUploadRequest
	if !s.decode(w, r, &body) {
		return
	}
	contentType := strings.ToLower(strings.TrimSpace(body.ContentType))
	var folder, ext string
	switch strings.TrimSpace(body.Kind) {
	case "video":
		folder, ext = "videos", unloopVideoTypes[contentType]
		if ext == "" {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				"A video must be MP4, WebM or MOV.", apierr.Detail{Field: "contentType", Rule: "enum"}))
			return
		}
	case "thumbnail":
		folder, ext = "thumbnails", unloopImageTypes[contentType]
		if ext == "" {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				"A thumbnail must be JPEG, PNG or WebP.", apierr.Detail{Field: "contentType", Rule: "enum"}))
			return
		}
	default:
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"kind must be video or thumbnail.", apierr.Detail{Field: "kind", Rule: "enum"}))
		return
	}

	name, err := newUUID()
	if err != nil {
		s.unavailable(w, r, "name an Unloop upload", err)
		return
	}
	path := folder + "/" + name + "." + ext
	uploadURL, err := s.backend.SignUnloopUpload(r.Context(), s.token(r), path)
	if err != nil {
		s.dataFailure(w, r, "sign an Unloop upload", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusCreated, struct {
		Path      string `json:"path"`
		UploadURL string `json:"uploadUrl"`
	}{Path: path, UploadURL: uploadURL})
}

type unloopChangeView struct {
	ID     string `json:"id"`
	Status string `json:"status,omitempty"`
}

// unloopBody reads and validates a video. The database holds the same rules.
func (s *service) unloopBody(w http.ResponseWriter, r *http.Request) (supabaseadmin.UnloopDraft, bool) {
	var body unloopVideoRequest
	if !s.decode(w, r, &body) {
		return supabaseadmin.UnloopDraft{}, false
	}
	fail := func(message, field, rule string) (supabaseadmin.UnloopDraft, bool) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest, message,
			apierr.Detail{Field: field, Rule: rule}))
		return supabaseadmin.UnloopDraft{}, false
	}
	d := supabaseadmin.UnloopDraft{
		Title:           strings.TrimSpace(body.Title),
		Description:     strings.TrimSpace(body.Description),
		Category:        strings.TrimSpace(body.Category),
		VideoPath:       strings.TrimSpace(body.VideoPath),
		DurationSeconds: body.DurationSeconds,
		Status:          strings.TrimSpace(body.Status),
	}
	if body.ThumbnailPath != nil {
		d.ThumbnailPath = strings.TrimSpace(*body.ThumbnailPath)
	}
	if n := utf8.RuneCountInString(d.Title); n < 2 || n > 80 {
		return fail("A title is 2 to 80 characters.", "title", "length")
	}
	if utf8.RuneCountInString(d.Description) > maxUnloopDescriptionRunes {
		return fail("A description is at most 500 characters.", "description", "maxLength")
	}
	if !contains(unloopCategories, d.Category) {
		return fail("Pick a category from the list.", "category", "enum")
	}
	if !unloopVideoPath.MatchString(d.VideoPath) {
		return fail("Upload a video first.", "videoPath", "format")
	}
	if d.ThumbnailPath != "" && !unloopThumbnailPath.MatchString(d.ThumbnailPath) {
		return fail("Upload the thumbnail again.", "thumbnailPath", "format")
	}
	if d.DurationSeconds != nil {
		seconds := *d.DurationSeconds
		if math.IsNaN(seconds) || seconds < 0 || seconds > maxUnloopSeconds {
			return fail("A video is at most 10 minutes long.", "durationSeconds", "range")
		}
		rounded := math.Round(seconds*100) / 100
		d.DurationSeconds = &rounded
	}
	if !contains(unloopStatuses, d.Status) {
		return fail("status must be draft or published.", "status", "enum")
	}
	return d, true
}

// unloopFailure explains the one refusal an administrator can fix themselves: a
// file the database cannot find because its upload never finished.
func (s *service) unloopFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var dataErr *supabaseadmin.Error
	if errors.As(err, &dataErr) && dataErr.IsBadRequest() {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A file hasn't finished uploading. Upload it again and retry."))
		return
	}
	s.moderationFailure(w, r, operation, err)
}

// newUUID is a random version 4 UUID, the name of an uploaded file.
func newUUID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}
