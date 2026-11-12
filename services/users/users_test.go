package users

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/packages/go/platform/version"
	"github.com/r1jadi/unbored/services/users/internal/supabaseprofile"
)

// testSecret must be at least 32 characters; the verifier refuses shorter ones.
const testSecret = "test-secret-used-only-in-unit-tests-0123456789"

const (
	// testUserID is the subject signed into every token below.
	testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"
	// testOtherID is a second account, used to prove that no request can reach
	// it: the handlers have no parameter that could address it.
	testOtherID = "11111111-2222-4333-8444-555555555555"
)

// ── Fake backend ────────────────────────────────────────────────────────────

// fakeBackend stands in for the Data API. It records the token and subject every
// call was made with, which is how the suite proves identity comes from the
// verified token rather than the request. Every method takes the lock: handlers
// run on the server's goroutines.
type fakeBackend struct {
	mu sync.Mutex

	profile    supabaseprofile.Profile
	notFound   bool
	getErr     error
	updateErr  error
	updateMiss bool

	seenUserIDs []string
	seenTokens  []string
	seenPatches []supabaseprofile.Patch
	seenExpects []time.Time
}

func (f *fakeBackend) GetProfile(_ context.Context, accessToken, userID string) (supabaseprofile.Profile, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seenUserIDs = append(f.seenUserIDs, userID)
	f.seenTokens = append(f.seenTokens, accessToken)
	if f.getErr != nil {
		return supabaseprofile.Profile{}, false, f.getErr
	}
	if f.notFound {
		return supabaseprofile.Profile{}, false, nil
	}
	return f.profile, true, nil
}

func (f *fakeBackend) Update(_ context.Context, accessToken, userID string, patch supabaseprofile.Patch, expected time.Time) (supabaseprofile.Profile, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.seenUserIDs = append(f.seenUserIDs, userID)
	f.seenTokens = append(f.seenTokens, accessToken)
	f.seenPatches = append(f.seenPatches, patch)
	f.seenExpects = append(f.seenExpects, expected)
	if f.updateErr != nil {
		return supabaseprofile.Profile{}, false, f.updateErr
	}
	if f.updateMiss {
		return supabaseprofile.Profile{}, false, nil
	}
	updated := f.profile
	if patch.DisplayName != "" {
		updated.DisplayName = patch.DisplayName
	}
	if patch.Username != "" {
		updated.Username = patch.Username
	}
	if patch.SetBio {
		updated.Bio = patch.Bio
	}
	if patch.SetAvatar {
		updated.AvatarPath = patch.AvatarPath
	}
	updated.UpdatedAt = f.profile.UpdatedAt.Add(time.Second)
	return updated, true, nil
}

func (f *fakeBackend) userIDs() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.seenUserIDs...)
}

func (f *fakeBackend) tokens() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.seenTokens...)
}

func (f *fakeBackend) lastPatch() supabaseprofile.Patch {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.seenPatches) == 0 {
		return supabaseprofile.Patch{}
	}
	return f.seenPatches[len(f.seenPatches)-1]
}

func (f *fakeBackend) lastExpectation() time.Time {
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.seenExpects) == 0 {
		return time.Time{}
	}
	return f.seenExpects[len(f.seenExpects)-1]
}

// ── Fixtures ────────────────────────────────────────────────────────────────

func profileFixture() supabaseprofile.Profile {
	bio := "Puzzles in the morning."
	onboarded := time.Date(2026, 10, 2, 10, 0, 0, 0, time.UTC)
	return supabaseprofile.Profile{
		ID:          testUserID,
		Username:    "rijad",
		DisplayName: "Rijad Halili",
		Bio:         &bio,
		OnboardedAt: &onboarded,
		CreatedAt:   time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC),
		UpdatedAt:   time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC),
	}
}

// token signs a token the platform verifier accepts, with the given subject.
func token(t *testing.T, subject string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub":          subject,
		"email":        "player@example.com",
		"aud":          "authenticated",
		"iat":          time.Now().Add(-time.Minute).Unix(),
		"exp":          time.Now().Add(time.Hour).Unix(),
		"role":         "authenticated",
		"app_metadata": map[string]any{"role": "user"},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

// ── Harness ─────────────────────────────────────────────────────────────────

type harness struct {
	server  *httptest.Server
	logs    *bytes.Buffer
	backend *fakeBackend
}

// newHarness assembles the chain the binary serves: the standard router, probes
// and middleware with the users routes mounted on it. A nil backend is how a
// deployment without Supabase credentials behaves.
func newHarness(t *testing.T, backend Backend, withAuth bool) *harness {
	t.Helper()
	return buildHarness(t, backend, withAuth, nil)
}

func buildHarness(t *testing.T, backend Backend, withAuth bool, avatars *avatarPipeline) *harness {
	t.Helper()

	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("LOG_LEVEL", "debug")
	if withAuth {
		t.Setenv("SUPABASE_JWT_SECRET", testSecret)
		t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")
	}

	cfg, err := config.Load("users-test")
	if err != nil {
		t.Fatalf("loading test configuration: %v", err)
	}

	var verifier *authn.Verifier
	if cfg.HasAuthMaterial() {
		verifier, err = authn.NewVerifier(cfg)
		if err != nil {
			t.Fatalf("building verifier: %v", err)
		}
	}

	logs := &bytes.Buffer{}
	logger := slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	shared := httpx.NewRateLimiter(cfg.HTTP.RateLimit)
	router := httpx.NewRouter(httpx.RouterOptions{
		Config:   cfg,
		Verifier: verifier,
		Logger:   logger,
		Limiter:  shared,
	})

	health := httpx.NewHealth(version.Version)
	health.RegisterHealthRoutes(router.Mux())
	newService(backend, logger).withAvatars(avatars).register(router)

	httpServer := httptest.NewServer(httpx.NewServer(httpx.ServerOptions{
		Config:  cfg,
		Router:  router,
		Health:  health,
		Logger:  logger,
		Limiter: shared,
	}).Handler)
	t.Cleanup(httpServer.Close)

	fake, _ := backend.(*fakeBackend)
	return &harness{server: httpServer, logs: logs, backend: fake}
}

func (h *harness) do(t *testing.T, method, path, body string, auth string) *http.Response {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	request, err := http.NewRequest(method, h.server.URL+path, reader)
	if err != nil {
		t.Fatalf("building request: %v", err)
	}
	if body != "" {
		request.Header.Set("Content-Type", "application/json")
	}
	if auth != "" {
		request.Header.Set("Authorization", "Bearer "+auth)
	}
	response, err := h.server.Client().Do(request)
	if err != nil {
		t.Fatalf("performing request: %v", err)
	}
	return response
}

func decoded(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("decoding body %q: %v", raw, err)
	}
	return body
}

func errorCode(t *testing.T, response *http.Response) string {
	t.Helper()
	body := decoded(t, response)
	envelope, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("response has no error envelope: %v", body)
	}
	code, _ := envelope["code"].(string)
	return code
}

func errorField(t *testing.T, response *http.Response) string {
	t.Helper()
	_, field := errorEnvelope(t, response)
	return field
}

// errorEnvelope reads the envelope once and returns both halves, because a
// response body can only be consumed once.
func errorEnvelope(t *testing.T, response *http.Response) (string, string) {
	t.Helper()
	body := decoded(t, response)
	envelope, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("response has no error envelope: %v", body)
	}
	code, _ := envelope["code"].(string)
	details, _ := envelope["details"].([]any)
	if len(details) == 0 {
		return code, ""
	}
	first, _ := details[0].(map[string]any)
	field, _ := first["field"].(string)
	return code, field
}

// ── GET /users/me ───────────────────────────────────────────────────────────

func TestGetProfileReturnsTheCallersOwnRow(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodGet, ProfilePath, "", token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET %s = %d, want 200", ProfilePath, response.StatusCode)
	}
	body := decoded(t, response)

	if body["id"] != testUserID {
		t.Errorf("id = %v, want %s", body["id"], testUserID)
	}
	if body["username"] != "rijad" {
		t.Errorf("username = %v, want rijad", body["username"])
	}
	if body["displayName"] != "Rijad Halili" {
		t.Errorf("displayName = %v, want Rijad Halili", body["displayName"])
	}
	if body["role"] != "user" {
		t.Errorf("role = %v, want user", body["role"])
	}
	if _, ok := body["updatedAt"]; !ok {
		t.Error("updatedAt is missing; a client needs it for the PATCH concurrency control")
	}
	// The column the SELECT grant excludes must not appear, whatever else changes.
	if _, ok := body["is_suspended"]; ok {
		t.Error("the response exposes is_suspended, which the SELECT grant excludes")
	}
	if _, ok := body["isSuspended"]; ok {
		t.Error("the response exposes isSuspended, which the SELECT grant excludes")
	}
}

func TestGetProfileUsesTheTokenSubjectNotTheRequest(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	// Every way a caller might try to name somebody else: a query parameter and a
	// body. Neither exists in the handler, and the assertion below is what proves
	// it rather than the absence of a field in a struct.
	response := h.do(t, http.MethodGet, ProfilePath+"?id="+testOtherID+"&userID="+testOtherID,
		`{"id":"`+testOtherID+`"}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("GET = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	for _, seen := range backend.userIDs() {
		if seen != testUserID {
			t.Errorf("backend was asked for %q, want only the token subject %q", seen, testUserID)
		}
	}
	if len(backend.userIDs()) == 0 {
		t.Fatal("the backend was never called")
	}
	for _, seen := range backend.tokens() {
		if seen == "" {
			t.Error("the profile call was made without the caller's token, so RLS could not apply")
		}
	}
}

func TestGetProfileWithoutAToken(t *testing.T) {
	h := newHarness(t, &fakeBackend{profile: profileFixture()}, true)

	response := h.do(t, http.MethodGet, ProfilePath, "", "")
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if code := errorCode(t, response); code != "unauthorized" {
		t.Errorf("code = %q, want unauthorized", code)
	}
}

func TestGetProfileWithAnInvalidToken(t *testing.T) {
	h := newHarness(t, &fakeBackend{profile: profileFixture()}, true)

	cases := map[string]string{
		"not a jwt at all": "not-a-token",
		"a forged signature": func() string {
			forged := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"sub": testOtherID, "aud": "authenticated",
				"exp": time.Now().Add(time.Hour).Unix(),
			})
			signed, err := forged.SignedString([]byte("a-different-secret-of-sufficient-length-000000"))
			if err != nil {
				t.Fatalf("signing forged token: %v", err)
			}
			return signed
		}(),
		"an expired token": func() string {
			expired := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
				"sub": testUserID, "aud": "authenticated",
				"iat": time.Now().Add(-2 * time.Hour).Unix(),
				"exp": time.Now().Add(-time.Hour).Unix(),
			})
			signed, err := expired.SignedString([]byte(testSecret))
			if err != nil {
				t.Fatalf("signing expired token: %v", err)
			}
			return signed
		}(),
	}
	for name, value := range cases {
		t.Run(name, func(t *testing.T) {
			response := h.do(t, http.MethodGet, ProfilePath, "", value)
			if response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", response.StatusCode)
			}
			response.Body.Close()
		})
	}
}

func TestGetProfileWhenTheRowIsMissing(t *testing.T) {
	h := newHarness(t, &fakeBackend{notFound: true}, true)

	response := h.do(t, http.MethodGet, ProfilePath, "", token(t, testUserID))
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
	if code := errorCode(t, response); code != "not_found" {
		t.Errorf("code = %q, want not_found", code)
	}
}

func TestProfileRoutesWhenSupabaseIsNotConfigured(t *testing.T) {
	// A nil backend is a deployment with no Supabase credentials: it still boots
	// and still authenticates, and answers 503 rather than crashing.
	h := newHarness(t, nil, true)

	for _, tc := range []struct{ method, body string }{
		{http.MethodGet, ""},
		{http.MethodPatch, `{"displayName":"New"}`},
	} {
		response := h.do(t, tc.method, ProfilePath, tc.body, token(t, testUserID))
		if response.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("%s = %d, want 503", tc.method, response.StatusCode)
		}
		if code := errorCode(t, response); code != "service_unavailable" {
			t.Errorf("%s code = %q, want service_unavailable", tc.method, code)
		}
	}
}

// ── PATCH /users/me ─────────────────────────────────────────────────────────

func TestPatchProfileWritesTheCallersOwnRow(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath,
		`{"displayName":"  Rijad H  ","bio":"New bio"}`,
		token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PATCH = %d, want 200", response.StatusCode)
	}
	body := decoded(t, response)
	if body["displayName"] != "Rijad H" {
		t.Errorf("displayName = %v, want the trimmed value", body["displayName"])
	}

	patch := backend.lastPatch()
	if patch.DisplayName != "Rijad H" {
		t.Errorf("backend received displayName %q, want the trimmed value", patch.DisplayName)
	}
	if !patch.SetBio || patch.Bio == nil || *patch.Bio != "New bio" {
		t.Errorf("backend received bio %v (set=%v), want New bio", patch.Bio, patch.SetBio)
	}
	if patch.SetAvatar {
		t.Errorf("an edit without avatarPath touched the avatar")
	}
	for _, seen := range backend.userIDs() {
		if seen != testUserID {
			t.Errorf("backend was asked for %q, want the token subject", seen)
		}
	}
}

func TestPatchClearsNullableFieldsWhenExplicitlyNull(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"bio":null,"avatarPath":null}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PATCH = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	patch := backend.lastPatch()
	if !patch.SetBio || patch.Bio != nil {
		t.Errorf("bio = %v (set=%v), want an explicit clear", patch.Bio, patch.SetBio)
	}
	if !patch.SetAvatar || patch.AvatarPath != nil {
		t.Errorf("avatar = %v (set=%v), want an explicit clear", patch.AvatarPath, patch.SetAvatar)
	}
}

func TestPatchLeavesUnmentionedFieldsAlone(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"displayName":"Only The Name"}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PATCH = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	patch := backend.lastPatch()
	if patch.SetBio || patch.SetAvatar {
		t.Errorf("a field the request did not mention was marked for writing: %+v", patch)
	}
}

func TestPatchRejectsFieldsNoClientMayWrite(t *testing.T) {
	// These are refused, not ignored: the contract says so, and silently dropping
	// a field teaches a client that it worked. `username` used to be in this
	// list; it is writable now and has its own tests below.
	for _, body := range []string{
		`{"role":"admin"}`,
		`{"isSuspended":true}`,
		`{"is_suspended":true}`,
		`{"onboardedAt":"2026-01-01T00:00:00Z"}`,
		`{"createdAt":"2026-01-01T00:00:00Z"}`,
		`{"displayName":"ok","updatedAt":"2026-01-01T00:00:00Z"}`,
		`{"id":"` + testOtherID + `"}`,
		`{"userId":"` + testOtherID + `"}`,
	} {
		t.Run(body, func(t *testing.T) {
			backend := &fakeBackend{profile: profileFixture()}
			h := newHarness(t, backend, true)

			response := h.do(t, http.MethodPatch, ProfilePath, body, token(t, testUserID))
			if response.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", response.StatusCode, body)
			}
			code, field := errorEnvelope(t, response)
			if code != "bad_request" {
				t.Errorf("code = %q, want bad_request", code)
			}
			if field == "" {
				t.Error("the refusal does not name the offending field")
			}
			if len(backend.userIDs()) != 0 {
				t.Error("a refused request still reached the database")
			}
		})
	}
}

func TestPatchRenamesTheCallersOwnRow(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath,
		`{"username":"rijad_2"}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PATCH = %d, want 200", response.StatusCode)
	}
	body := decoded(t, response)
	if body["username"] != "rijad_2" {
		t.Errorf("username = %v, want the renamed value", body["username"])
	}

	patch := backend.lastPatch()
	if patch.Username != "rijad_2" {
		t.Errorf("backend received username %q, want rijad_2", patch.Username)
	}
	for _, seen := range backend.userIDs() {
		if seen != testUserID {
			t.Errorf("backend was asked for %q, want the token subject", seen)
		}
	}
}

func TestPatchRejectsInvalidUsernames(t *testing.T) {
	cases := map[string]string{
		"a blank username":    `{"username":"   "}`,
		"a two-letter name":   `{"username":"ab"}`,
		"a 25-character name": `{"username":"` + strings.Repeat("a", 25) + `"}`,
		"uppercase letters":   `{"username":"Rijad"}`,
		"a space":             `{"username":"rija d"}`,
		"a dash":              `{"username":"rija-d"}`,
		"an at-sign":          `{"username":"@rijad"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			backend := &fakeBackend{profile: profileFixture()}
			h := newHarness(t, backend, true)

			response := h.do(t, http.MethodPatch, ProfilePath, body, token(t, testUserID))
			if response.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", response.StatusCode)
			}
			if field := errorField(t, response); field != "username" {
				t.Errorf("field = %q, want username", field)
			}
			if len(backend.userIDs()) != 0 {
				t.Error("an invalid request still reached the database")
			}
		})
	}
}

func TestPatchReportsATakenUsernameAsAFieldConflict(t *testing.T) {
	// Two writers can race on one name; the unique index decides, and the loser
	// gets a 409 that names the field — not the concurrency 409, which carries
	// no field and means "reload and try again".
	backend := &fakeBackend{
		profile:   profileFixture(),
		updateErr: &supabaseprofile.Error{Op: "update-profile", Status: http.StatusConflict, Code: "23505"},
	}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath,
		`{"username":"taken_name"}`, token(t, testUserID))
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.StatusCode)
	}
	code, field := errorEnvelope(t, response)
	if code != "conflict" {
		t.Errorf("code = %q, want conflict", code)
	}
	if field != "username" {
		t.Errorf("field = %q, want username, so the form shows it under the input", field)
	}
}

func TestPatchReportsTheWordFilterAsUnprocessable(t *testing.T) {
	// public.refuse_objectionable_text raises SQLSTATE UB001. The answer is ours,
	// never the database's text, which could echo what the player typed.
	backend := &fakeBackend{
		profile:   profileFixture(),
		updateErr: &supabaseprofile.Error{Op: "update-profile", Status: http.StatusBadRequest, Code: "UB001"},
	}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"bio":"something rude"}`, token(t, testUserID))
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.StatusCode)
	}
}

func TestPatchUsernameCannotAimAnotherAccount(t *testing.T) {
	// There is no id parameter anywhere in this service: query values and body
	// fields that try to name somebody else are either unknown (400) or ignored,
	// and the backend only ever sees the token subject.
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath+"?id="+testOtherID,
		`{"username":"new_name"}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("PATCH = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	for _, seen := range backend.userIDs() {
		if seen != testUserID {
			t.Errorf("backend was asked for %q, want only the token subject %q", seen, testUserID)
		}
	}
}

func TestPatchRejectsInvalidValues(t *testing.T) {
	cases := map[string]struct {
		body  string
		field string
	}{
		"a blank display name":     {`{"displayName":"   "}`, "displayName"},
		"a display name too long":  {`{"displayName":"` + strings.Repeat("a", maxDisplayNameRunes+1) + `"}`, "displayName"},
		"a bio too long":           {`{"bio":"` + strings.Repeat("b", maxBioRunes+1) + `"}`, "bio"},
		"an avatar path off shape": {`{"avatarPath":"not-a-path"}`, "avatarPath"},
		"an avatar path too long":  {`{"avatarPath":"` + testUserID + `/` + strings.Repeat("c", 121) + `"}`, "avatarPath"},
		"no fields at all":         {`{}`, "displayName"},
		"a null body":              {`null`, "displayName"},
		"only the control field":   {`{"expectedUpdatedAt":"2026-10-07T12:00:00Z"}`, "displayName"},
		"a bio of the wrong type":  {`{"bio":42}`, "bio"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			backend := &fakeBackend{profile: profileFixture()}
			h := newHarness(t, backend, true)

			response := h.do(t, http.MethodPatch, ProfilePath, tc.body, token(t, testUserID))
			if response.StatusCode != http.StatusUnprocessableEntity && response.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 422 or 400", response.StatusCode)
			}
			if field := errorField(t, response); field != tc.field {
				t.Errorf("field = %q, want %q", field, tc.field)
			}
			if len(backend.userIDs()) != 0 {
				t.Error("an invalid request still reached the database")
			}
		})
	}
}

func TestPatchRejectsMalformedBodies(t *testing.T) {
	cases := map[string]string{
		"truncated json": `{"displayName":`,
		"an array":       `[{"displayName":"x"}]`,
		"a bare string":  `"displayName"`,
		"two objects":    `{"displayName":"a"}{"displayName":"b"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			backend := &fakeBackend{profile: profileFixture()}
			h := newHarness(t, backend, true)

			response := h.do(t, http.MethodPatch, ProfilePath, body, token(t, testUserID))
			if response.StatusCode != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 for %s", response.StatusCode, body)
			}
			if len(backend.userIDs()) != 0 {
				t.Error("a malformed request still reached the database")
			}
		})
	}
}

func TestPatchRequiresAToken(t *testing.T) {
	h := newHarness(t, &fakeBackend{profile: profileFixture()}, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"displayName":"New"}`, "")
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if code := errorCode(t, response); code != "unauthorized" {
		t.Errorf("code = %q, want unauthorized", code)
	}
}

func TestPatchReportsAConcurrentChangeAsAConflict(t *testing.T) {
	// The write matched no row, but the row still exists: someone else moved it
	// between the caller's read and their write.
	backend := &fakeBackend{profile: profileFixture(), updateMiss: true}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath,
		`{"displayName":"New","expectedUpdatedAt":"2026-10-07T12:00:00Z"}`, token(t, testUserID))
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.StatusCode)
	}
	if code := errorCode(t, response); code != "conflict" {
		t.Errorf("code = %q, want conflict", code)
	}
	if got := backend.lastExpectation(); got.Format(time.RFC3339) != "2026-10-07T12:00:00Z" {
		t.Errorf("expectedUpdatedAt reaching the database = %v, want the value the caller sent", got)
	}
}

func TestPatchReportsAMissingRowAsNotFound(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture(), updateMiss: true, notFound: true}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"displayName":"New"}`, token(t, testUserID))
	if response.StatusCode != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", response.StatusCode)
	}
	if code := errorCode(t, response); code != "not_found" {
		t.Errorf("code = %q, want not_found", code)
	}
}

func TestPatchWithoutAnExpectationAcceptsLastWriteWins(t *testing.T) {
	backend := &fakeBackend{profile: profileFixture()}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"displayName":"New"}`, token(t, testUserID))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	response.Body.Close()

	if got := backend.lastExpectation(); !got.IsZero() {
		t.Errorf("an unguarded write sent an expectation (%v); the contract says omission means last-write-wins", got)
	}
}

func TestPatchPublishesADatabaseRefusalAsForbidden(t *testing.T) {
	backend := &fakeBackend{
		profile:   profileFixture(),
		updateErr: &supabaseprofile.Error{Op: "update-profile", Status: http.StatusForbidden, Code: "42501"},
	}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodPatch, ProfilePath, `{"displayName":"New"}`, token(t, testUserID))
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("status = %d, want 403", response.StatusCode)
	}
	if code := errorCode(t, response); code != "forbidden" {
		t.Errorf("code = %q, want forbidden", code)
	}
}

func TestProfileReadFailureIsReportedAsUnavailable(t *testing.T) {
	backend := &fakeBackend{getErr: &supabaseprofile.Error{Op: "read-profile", Status: http.StatusInternalServerError}}
	h := newHarness(t, backend, true)

	response := h.do(t, http.MethodGet, ProfilePath, "", token(t, testUserID))
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if code := errorCode(t, response); code != "service_unavailable" {
		t.Errorf("code = %q, want service_unavailable", code)
	}
}

func TestProfileResponsesNeverLeakTheToken(t *testing.T) {
	access := token(t, testUserID)
	h := newHarness(t, &fakeBackend{profile: profileFixture()}, true)

	response := h.do(t, http.MethodGet, ProfilePath, "", access)
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	if bytes.Contains(raw, []byte(access)) {
		t.Error("the response echoes the access token")
	}
	if bytes.Contains(h.logs.Bytes(), []byte(access)) {
		t.Error("the logs contain the access token")
	}
}
