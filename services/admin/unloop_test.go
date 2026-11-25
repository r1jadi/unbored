package admin

import (
	"context"
	"net/http"
	"regexp"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

const (
	unloopVideoFile = "videos/0b4c8f8e-2d3a-4c1e-9b7a-5e6f7a8b9c0d.mp4"
	unloopThumbFile = "thumbnails/0b4c8f8e-2d3a-4c1e-9b7a-5e6f7a8b9c0d.jpg"
	unloopVideoID   = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b"
)

func (f *fakeBackend) UnloopVideos(_ context.Context, token, actor, status string, page supabaseadmin.Page) ([]supabaseadmin.UnloopVideo, error) {
	f.record("UnloopVideos", status)
	f.lastPage = page
	f.lastActor = actor
	return []supabaseadmin.UnloopVideo{{ID: unloopVideoID, Title: "First loop", Category: "highlights", VideoPath: unloopVideoFile, Status: "published", Likes: 4}}, f.readErr
}

func (f *fakeBackend) SaveUnloopVideo(_ context.Context, token, actor, id string, d supabaseadmin.UnloopDraft) (supabaseadmin.UnloopSaved, error) {
	f.record("SaveUnloopVideo", id, d.Title, d.Description, d.Category, d.VideoPath, d.ThumbnailPath, d.Status)
	f.lastActor = actor
	if id == "" {
		id = unloopVideoID
	}
	return supabaseadmin.UnloopSaved{ID: id, Status: d.Status}, f.actionErr
}

func (f *fakeBackend) DeleteUnloopVideo(_ context.Context, token, actor, id string) (supabaseadmin.UnloopDeleted, error) {
	f.record("DeleteUnloopVideo", id)
	f.lastActor = actor
	return supabaseadmin.UnloopDeleted{ID: id, VideoPath: unloopVideoFile}, f.actionErr
}

func (f *fakeBackend) SignUnloopUpload(_ context.Context, token, path string) (string, error) {
	f.record("SignUnloopUpload", path)
	return "https://project.supabase.co/storage/v1/object/upload/sign/unloop/" + path + "?token=t", f.actionErr
}

func validUnloopBody() map[string]any {
	return map[string]any{
		"title":           "  First loop ",
		"description":     "A clean run",
		"category":        "highlights",
		"videoPath":       unloopVideoFile,
		"thumbnailPath":   unloopThumbFile,
		"durationSeconds": 12.345,
		"status":          "published",
	}
}

// TestOnlyAdministratorsPublishUnloop: a moderator, however valid their row, and a
// player never reach the database for any Unloop route.
func TestOnlyAdministratorsPublishUnloop(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	for _, who := range []struct {
		name, role, email string
	}{
		{"moderator", "moderator", "mod@example.com"},
		{"player", "user", "player@example.com"},
	} {
		backend := &guardBackend{fakeBackend: &fakeBackend{}, dbRole: who.role}
		server, sign := newAllowlistServer(t, backend)
		token := sign(testModerator, who.role, who.email)

		for _, route := range []struct {
			method, path string
			body         any
		}{
			{http.MethodGet, UnloopVideosPath, nil},
			{http.MethodPost, UnloopVideosPath, validUnloopBody()},
			{http.MethodPatch, "/api/v1/admin/unloop/videos/" + unloopVideoID, validUnloopBody()},
			{http.MethodDelete, "/api/v1/admin/unloop/videos/" + unloopVideoID, nil},
			{http.MethodPost, UnloopUploadsPath, map[string]any{"kind": "video", "contentType": "video/mp4"}},
		} {
			if status, payload := call(t, server, route.method, route.path, token, route.body); status != http.StatusForbidden {
				t.Errorf("a %s calling %s %s = %d, want 403 (%v)", who.name, route.method, route.path, status, payload)
			}
		}
		for _, method := range []string{"UnloopVideos", "SaveUnloopVideo", "DeleteUnloopVideo", "SignUnloopUpload"} {
			if backend.called(method) {
				t.Errorf("a %s reached %s", who.name, method)
			}
		}
	}
}

func TestAdministratorPublishesUnloop(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "user", "admin@example.com")

	status, payload := call(t, server, http.MethodPost, UnloopVideosPath, token, validUnloopBody())
	if status != http.StatusCreated || payload["id"] != unloopVideoID || payload["status"] != "published" {
		t.Fatalf("create = %d %v, want 201 with the new id", status, payload)
	}
	want := "|First loop|A clean run|highlights|" + unloopVideoFile + "|" + unloopThumbFile + "|published"
	if got := strings.Join(backend.lastArgs, "|"); got != want {
		t.Errorf("create reached the database as %q, want %q", got, want)
	}
	if backend.lastActor != testAdmin {
		t.Errorf("attributed to %q, want the verified administrator", backend.lastActor)
	}

	body := validUnloopBody()
	body["thumbnailPath"] = nil
	body["status"] = "draft"
	status, payload = call(t, server, http.MethodPatch, "/api/v1/admin/unloop/videos/"+strings.ToUpper(unloopVideoID), token, body)
	if status != http.StatusOK || payload["status"] != "draft" {
		t.Errorf("update = %d %v, want 200", status, payload)
	}
	if backend.lastArgs[0] != unloopVideoID || backend.lastArgs[5] != "" {
		t.Errorf("update reached the database as %v", backend.lastArgs)
	}

	status, payload = call(t, server, http.MethodGet, UnloopVideosPath+"?status=published", token, nil)
	items, _ := payload["items"].([]any)
	if status != http.StatusOK || len(items) != 1 {
		t.Fatalf("list = %d %v, want one video", status, payload)
	}
	if first := items[0].(map[string]any); first["videoPath"] != unloopVideoFile || first["likes"] != float64(4) {
		t.Errorf("list item = %v", first)
	}

	if status, payload := call(t, server, http.MethodDelete, "/api/v1/admin/unloop/videos/"+unloopVideoID, token, nil); status != http.StatusOK || payload["id"] != unloopVideoID {
		t.Errorf("delete = %d %v, want 200", status, payload)
	}
}

func TestUnloopUploadsAreNamedByTheService(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "user", "admin@example.com")

	status, payload := call(t, server, http.MethodPost, UnloopUploadsPath, token,
		map[string]any{"kind": "video", "contentType": "video/webm"})
	path, _ := payload["path"].(string)
	if status != http.StatusCreated || !unloopVideoPath.MatchString(path) || !strings.HasSuffix(path, ".webm") {
		t.Fatalf("video upload = %d %v, want 201 with a minted .webm path", status, payload)
	}
	if url, _ := payload["uploadUrl"].(string); !strings.Contains(url, path) {
		t.Errorf("upload url %q is not for %q", url, path)
	}

	status, payload = call(t, server, http.MethodPost, UnloopUploadsPath, token,
		map[string]any{"kind": "thumbnail", "contentType": "image/png"})
	path, _ = payload["path"].(string)
	if status != http.StatusCreated || !unloopThumbnailPath.MatchString(path) {
		t.Fatalf("thumbnail upload = %d %v, want 201 with a minted path", status, payload)
	}

	for _, body := range []map[string]any{
		{"kind": "video", "contentType": "image/png"},
		{"kind": "thumbnail", "contentType": "video/mp4"},
		{"kind": "video", "contentType": "text/html"},
		{"kind": "page", "contentType": "video/mp4"},
	} {
		if status, payload := call(t, server, http.MethodPost, UnloopUploadsPath, token, body); status != http.StatusBadRequest {
			t.Errorf("upload %v = %d, want 400 (%v)", body, status, payload)
		}
	}
}

func TestUnloopWritesValidateBeforeTheDatabase(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "user", "admin@example.com")

	cases := map[string]func(map[string]any){
		"short title":         func(b map[string]any) { b["title"] = "x" },
		"long title":          func(b map[string]any) { b["title"] = strings.Repeat("a", 81) },
		"long description":    func(b map[string]any) { b["description"] = strings.Repeat("a", 501) },
		"unknown category":    func(b map[string]any) { b["category"] = "cats" },
		"foreign video path":  func(b map[string]any) { b["videoPath"] = "avatars/someone/photo.png" },
		"traversal":           func(b map[string]any) { b["videoPath"] = "videos/../avatars/x.mp4" },
		"foreign thumbnail":   func(b map[string]any) { b["thumbnailPath"] = "videos/x.jpg" },
		"negative duration":   func(b map[string]any) { b["durationSeconds"] = -1 },
		"too long":            func(b map[string]any) { b["durationSeconds"] = 601 },
		"unknown status":      func(b map[string]any) { b["status"] = "archived" },
		"unknown field":       func(b map[string]any) { b["createdBy"] = testAdmin },
		"missing video":       func(b map[string]any) { delete(b, "videoPath") },
		"missing category":    func(b map[string]any) { delete(b, "category") },
		"blank title trimmed": func(b map[string]any) { b["title"] = "   " },
	}
	for name, mutate := range cases {
		body := validUnloopBody()
		mutate(body)
		if status, payload := call(t, server, http.MethodPost, UnloopVideosPath, token, body); status != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400 (%v)", name, status, payload)
		}
	}
	if backend.called("SaveUnloopVideo") {
		t.Error("an invalid video reached the database")
	}
	if status, _ := call(t, server, http.MethodPatch, "/api/v1/admin/unloop/videos/not-a-uuid", token, validUnloopBody()); status != http.StatusBadRequest {
		t.Errorf("a malformed id = %d, want 400", status)
	}
}

func TestUnloopMissingUploadIsExplained(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{actionErr: &supabaseadmin.Error{Op: "unloop-save", Status: 400, Code: "22023"}}}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "user", "admin@example.com")

	status, payload := call(t, server, http.MethodPost, UnloopVideosPath, token, validUnloopBody())
	if status != http.StatusBadRequest {
		t.Fatalf("missing upload = %d, want 400 (%v)", status, payload)
	}
	message, _ := payload["error"].(map[string]any)["message"].(string)
	if !regexp.MustCompile(`(?i)upload`).MatchString(message) {
		t.Errorf("message %q does not say what to do", message)
	}
}

func TestNewUUIDIsVersion4(t *testing.T) {
	seen := map[string]bool{}
	for range 50 {
		id, err := newUUID()
		if err != nil {
			t.Fatal(err)
		}
		if !regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id) || seen[id] {
			t.Fatalf("bad or repeated uuid %q", id)
		}
		seen[id] = true
	}
}
