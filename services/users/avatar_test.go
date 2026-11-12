package users

import (
	"context"
	"errors"
	"net/http"
	"sync"
	"testing"

	"github.com/r1jadi/unbored/services/users/internal/avatarscreen"
	"github.com/r1jadi/unbored/services/users/internal/avatarstore"
)

var pngBytes = []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3}

type fakeStore struct {
	mu        sync.Mutex
	held      map[string][]byte
	heldType  string
	published []string
	removed   []string
	setPath   string
	failSet   bool
}

func (f *fakeStore) Fetch(_ context.Context, path string) ([]byte, string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	picture, ok := f.held[path]
	if !ok {
		return nil, "", avatarstore.ErrNotFound
	}
	return picture, f.heldType, nil
}

func (f *fakeStore) Publish(_ context.Context, path string, _ []byte, _ string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.published = append(f.published, path)
	return nil
}

func (f *fakeStore) SetAvatarPath(_ context.Context, _ string, path string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.failSet {
		return errors.New("refused")
	}
	f.setPath = path
	return nil
}

func (f *fakeStore) Remove(_ context.Context, bucket, path string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.removed = append(f.removed, bucket+"/"+path)
	return nil
}

type fakeScreener struct {
	verdict avatarscreen.Verdict
	err     error
	calls   int
}

func (f *fakeScreener) Screen(context.Context, []byte, string) (avatarscreen.Verdict, error) {
	f.calls++
	return f.verdict, f.err
}

func avatarHarness(t *testing.T, store *fakeStore, screener *fakeScreener) *harness {
	t.Helper()
	backend := &fakeBackend{profile: profileFixture()}
	return buildHarness(t, backend, true, &avatarPipeline{store: store, screener: screener})
}

func heldPicture() (*fakeStore, string) {
	path := testUserID + "/new.png"
	return &fakeStore{held: map[string][]byte{path: pngBytes}, heldType: "image/png"}, path
}

func contains(list []string, want string) bool {
	for _, item := range list {
		if item == want {
			return true
		}
	}
	return false
}

func TestUploadAvatarPublishesAPictureThatPasses(t *testing.T) {
	store, path := heldPicture()
	screener := &fakeScreener{}
	h := avatarHarness(t, store, screener)

	response := h.do(t, http.MethodPost, AvatarPath, `{"uploadPath":"`+path+`"}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	response.Body.Close()
	if screener.calls != 1 {
		t.Errorf("screened %d times, want once", screener.calls)
	}
	if !contains(store.published, path) || store.setPath != path {
		t.Errorf("published %v and set %q, want %q", store.published, store.setPath, path)
	}
	if !contains(store.removed, avatarstore.HoldingBucket+"/"+path) {
		t.Errorf("the held copy was not cleared: %v", store.removed)
	}
}

func TestUploadAvatarRefusesAFlaggedPictureAndPublishesNothing(t *testing.T) {
	store, path := heldPicture()
	screener := &fakeScreener{verdict: avatarscreen.Verdict{Flagged: true, Categories: []string{"sexual"}}}
	h := avatarHarness(t, store, screener)

	response := h.do(t, http.MethodPost, AvatarPath, `{"uploadPath":"`+path+`"}`, token(t, testUserID))
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.StatusCode)
	}
	if _, field := errorEnvelope(t, response); field != "uploadPath" {
		t.Errorf("field = %q, want uploadPath", field)
	}
	if len(store.published) != 0 || store.setPath != "" {
		t.Errorf("a refused picture was published: %v / %q", store.published, store.setPath)
	}
	if !contains(store.removed, avatarstore.HoldingBucket+"/"+path) {
		t.Errorf("the refused picture was not deleted: %v", store.removed)
	}
}

func TestUploadAvatarFailsClosedWhenScreeningIsDown(t *testing.T) {
	store, path := heldPicture()
	h := avatarHarness(t, store, &fakeScreener{err: errors.New("openai unavailable")})

	response := h.do(t, http.MethodPost, AvatarPath, `{"uploadPath":"`+path+`"}`, token(t, testUserID))
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	response.Body.Close()
	if len(store.published) != 0 {
		t.Errorf("an unscreened picture was published: %v", store.published)
	}
}

func TestUploadAvatarRefusesAnotherAccountsFolder(t *testing.T) {
	store := &fakeStore{held: map[string][]byte{testOtherID + "/x.png": pngBytes}, heldType: "image/png"}
	screener := &fakeScreener{}
	h := avatarHarness(t, store, screener)

	response := h.do(t, http.MethodPost, AvatarPath, `{"uploadPath":"`+testOtherID+`/x.png"}`, token(t, testUserID))
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.StatusCode)
	}
	response.Body.Close()
	if screener.calls != 0 || len(store.removed) != 0 {
		t.Errorf("another account's upload was touched")
	}
}

func TestUploadAvatarRefusesAFileThatIsNotAPicture(t *testing.T) {
	path := testUserID + "/fake.png"
	store := &fakeStore{held: map[string][]byte{path: []byte("<html>not a picture</html>")}, heldType: "image/png"}
	screener := &fakeScreener{}
	h := avatarHarness(t, store, screener)

	response := h.do(t, http.MethodPost, AvatarPath, `{"uploadPath":"`+path+`"}`, token(t, testUserID))
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.StatusCode)
	}
	response.Body.Close()
	if screener.calls != 0 {
		t.Errorf("a file that is not a picture was sent for screening")
	}
}

func TestUploadAvatarAnswers503WhenUploadsAreNotConfigured(t *testing.T) {
	h := buildHarness(t, &fakeBackend{profile: profileFixture()}, true, nil)
	response := h.do(t, http.MethodPost, AvatarPath, `{"uploadPath":"`+testUserID+`/a.png"}`, token(t, testUserID))
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	response.Body.Close()
}

func TestPatchRefusesSettingAnAvatarPathDirectly(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"avatarPath":"`+testUserID+`/avatar.png"}`, token(t, testUserID))
	if response.StatusCode != http.StatusUnprocessableEntity && response.StatusCode != http.StatusBadRequest {
		t.Fatalf("status = %d, want a validation error", response.StatusCode)
	}
	if _, field := errorEnvelope(t, response); field != "avatarPath" {
		t.Errorf("field = %q, want avatarPath", field)
	}
}
