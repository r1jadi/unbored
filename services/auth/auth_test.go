package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/packages/go/platform/version"
	"github.com/r1jadi/unbored/services/auth/internal/supabaseauth"
)

// testSecret must be at least 32 characters; the verifier refuses shorter ones.
const testSecret = "test-secret-used-only-in-unit-tests-0123456789"

const testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"

// ── Fake backend ────────────────────────────────────────────────────────────

// fakeBackend stands in for Supabase. Every method takes the lock: handlers run
// on the server's goroutines and this suite runs under -race in CI, so no
// observation of a field may be unsynchronised.
type fakeBackend struct {
	mu sync.Mutex

	signUpResult      supabaseauth.Result
	signUpErr         error
	usernameAvailable bool
	// usernameAnswers, when set, is consumed one answer per lookup, so a test
	// can model a name that is available at the pre-flight check and taken by
	// the time the insert runs.
	usernameAnswers  []bool
	usernameErr      error
	signInResult     supabaseauth.Result
	signInErr        error
	refreshResult    supabaseauth.Result
	refreshErr       error
	signOutErr       error
	onboardedValue   bool
	onboardedErr     error
	userResult       supabaseauth.User
	userErr          error
	markOnboardedErr error

	signInEmail       string
	signUpUsername    string
	signUpDisplayName string
	signUpHits        int
	usernameChecks    []string
	refreshTokens     []string
	signOutTokens     []string
	onboardedHits     int
	userHits          int
	markHits          int
	markedAt          []time.Time
}

func (f *fakeBackend) SignUp(_ context.Context, _, _, username, displayName string) (supabaseauth.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.signUpHits++
	f.signUpUsername = username
	f.signUpDisplayName = displayName
	return f.signUpResult, f.signUpErr
}

func (f *fakeBackend) UsernameAvailable(_ context.Context, username string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.usernameChecks = append(f.usernameChecks, username)
	if f.usernameErr != nil {
		return false, f.usernameErr
	}
	if len(f.usernameAnswers) > 0 {
		answer := f.usernameAnswers[0]
		f.usernameAnswers = f.usernameAnswers[1:]
		return answer, nil
	}
	return f.usernameAvailable, nil
}

func (f *fakeBackend) SignInWithPassword(_ context.Context, email, _ string) (supabaseauth.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.signInEmail = email
	return f.signInResult, f.signInErr
}

func (f *fakeBackend) RefreshSession(_ context.Context, refreshToken string) (supabaseauth.Result, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.refreshTokens = append(f.refreshTokens, refreshToken)
	return f.refreshResult, f.refreshErr
}

func (f *fakeBackend) SignOut(_ context.Context, accessToken string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.signOutTokens = append(f.signOutTokens, accessToken)
	return f.signOutErr
}

func (f *fakeBackend) Onboarding(_ context.Context, _, _ string) (supabaseauth.Onboarding, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.onboardedHits++
	if f.onboardedErr != nil {
		return supabaseauth.Onboarding{}, f.onboardedErr
	}
	if !f.onboardedValue {
		return supabaseauth.Onboarding{}, nil
	}
	at := time.Now().UTC()
	return supabaseauth.Onboarding{CompletedAt: &at}, nil
}

func (f *fakeBackend) User(_ context.Context, _ string) (supabaseauth.User, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.userHits++
	return f.userResult, f.userErr
}

func (f *fakeBackend) MarkOnboarded(_ context.Context, _, _ string, at time.Time) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.markHits++
	f.markedAt = append(f.markedAt, at)
	return f.markOnboardedErr
}

func (f *fakeBackend) emailSeen() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.signInEmail
}

func (f *fakeBackend) signupName() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.signUpUsername
}

func (f *fakeBackend) signupCalls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.signUpHits
}

func (f *fakeBackend) usernameLookups() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.usernameChecks...)
}

func (f *fakeBackend) refreshes() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.refreshTokens...)
}

func (f *fakeBackend) signOuts() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]string(nil), f.signOutTokens...)
}

func (f *fakeBackend) onboardedReads() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.onboardedHits
}

func (f *fakeBackend) userReads() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.userHits
}

func (f *fakeBackend) marked() (int, []time.Time) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.markHits, append([]time.Time(nil), f.markedAt...)
}

// ── Fixtures ────────────────────────────────────────────────────────────────

func testUser(email, role string, confirmed bool) *supabaseauth.User {
	user := &supabaseauth.User{ID: testUserID, Email: email, CreatedAt: time.Now().UTC()}
	if role != "" {
		user.AppMetadata = map[string]any{"role": role}
	}
	if confirmed {
		at := time.Now().UTC()
		user.EmailConfirmedAt = &at
	}
	return user
}

func sessionResult(access, refresh string) supabaseauth.Result {
	return supabaseauth.Result{
		Session: &supabaseauth.Session{
			AccessToken:  access,
			RefreshToken: refresh,
			TokenType:    "bearer",
			ExpiresIn:    3600,
			ExpiresAt:    time.Now().Add(time.Hour).UTC(),
		},
		User: testUser("player@example.com", "user", true),
	}
}

// ── Server harness ──────────────────────────────────────────────────────────

type harness struct {
	server  *httptest.Server
	logs    *bytes.Buffer
	backend *fakeBackend
}

type harnessOptions struct {
	// backend may be nil, which is how a deployment without Supabase credentials
	// behaves.
	backend Backend
	// credentials is the extra bucket the credential handlers meter themselves
	// in; nil disables it.
	credentials *httpx.RateLimiter
	// withAuth installs a verifier, as a deployment given Supabase auth material
	// would have.
	withAuth bool
	// registerWith, when set, replaces the service wiring. It is how the
	// production Options() entrypoint is exercised.
	registerWith func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, verifier *authn.Verifier)
}

// newHarness assembles the same chain the binary serves: the standard router,
// probes, middleware and server, with the auth routes mounted on it.
func newHarness(t *testing.T, opts harnessOptions) *harness {
	t.Helper()

	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("LOG_LEVEL", "debug")
	if opts.withAuth {
		t.Setenv("SUPABASE_JWT_SECRET", testSecret)
		t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")
	}

	cfg, err := config.Load("auth-test")
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

	registerWith := opts.registerWith
	if registerWith == nil {
		registerWith = func(router *httpx.Router, _ *config.Config, logger *slog.Logger, verifier *authn.Verifier) {
			newService(opts.backend, verifier, logger, opts.credentials).register(router)
		}
	}
	registerWith(router, cfg, logger, verifier)

	serverOptions := httpx.ServerOptions{
		Config:  cfg,
		Router:  router,
		Health:  health,
		Logger:  logger,
		Limiter: shared,
	}
	if opts.credentials != nil {
		serverOptions.ExtraLimiters = []*httpx.RateLimiter{opts.credentials}
	}

	httpServer := httptest.NewServer(httpx.NewServer(serverOptions).Handler)
	t.Cleanup(httpServer.Close)

	backend, _ := opts.backend.(*fakeBackend)
	return &harness{server: httpServer, logs: logs, backend: backend}
}

func (h *harness) do(t *testing.T, method, path, body string, headers map[string]string) *http.Response {
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
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("%s %s failed: %v", method, path, err)
	}
	return response
}

// send posts a credential body and closes the response, for tests that only care
// about a side effect.
func (h *harness) send(t *testing.T, method, path, body, token string) {
	t.Helper()
	headers := map[string]string{}
	if token != "" {
		headers["Authorization"] = "Bearer " + token
	}
	h.do(t, method, path, body, headers).Body.Close()
}

func (h *harness) get(t *testing.T, path, token string) *http.Response {
	t.Helper()
	headers := map[string]string{}
	if token != "" {
		headers["Authorization"] = "Bearer " + token
	}
	return h.do(t, http.MethodGet, path, "", headers)
}

func decode(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	if len(raw) == 0 {
		return nil
	}
	payload := map[string]any{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("response is not JSON: %v (%s)", err, raw)
	}
	return payload
}

func errorCode(t *testing.T, response *http.Response) string {
	t.Helper()
	payload := decode(t, response)
	envelope, ok := payload["error"].(map[string]any)
	if !ok {
		t.Fatalf("response has no error envelope: %v", payload)
	}
	code, _ := envelope["code"].(string)
	return code
}

// jwtFor signs an access token the way Supabase would. HS256 stands in for the
// project's asymmetric key: the verifier treats both identically.
func jwtFor(t *testing.T, subject string, expiry time.Time, appMeta map[string]any) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub":          subject,
		"email":        "player@example.com",
		"aud":          "authenticated",
		"iat":          time.Now().Add(-time.Minute).Unix(),
		"exp":          expiry.Unix(),
		"role":         "authenticated",
		"app_metadata": appMeta,
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing test token: %v", err)
	}
	return signed
}

func validToken(t *testing.T, appMeta map[string]any) string {
	t.Helper()
	return jwtFor(t, testUserID, time.Now().Add(time.Hour), appMeta)
}

// serverKeyToken signs a token whose top-level `role` claim is not
// `authenticated` — the shape a leaked anon or service-role project key has.
// Such a token can carry a genuine signature and still must never be treated as
// a signed-in end user.
func serverKeyToken(t *testing.T, role string) string {
	t.Helper()
	claims := jwt.MapClaims{
		"sub":  testUserID,
		"aud":  "authenticated",
		"iat":  time.Now().Add(-time.Minute).Unix(),
		"exp":  time.Now().Add(time.Hour).Unix(),
		"role": role,
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("signing %s token: %v", role, err)
	}
	return signed
}

// ── Registration and sign-in ────────────────────────────────────────────────

func TestSignUpCreatesAnAccountAndReturnsTheSession(t *testing.T) {
	backend := &fakeBackend{signUpResult: sessionResult("access-from-signup", "refresh-from-signup")}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}

	payload := decode(t, response)
	session, ok := payload["session"].(map[string]any)
	if !ok {
		t.Fatalf("response has no session object: %v", payload)
	}
	if session["userId"] != testUserID {
		t.Errorf("session.userId = %v, want %s", session["userId"], testUserID)
	}
	if session["role"] != "user" {
		t.Errorf("session.role = %v, want user", session["role"])
	}
	if session["onboarded"] != false {
		t.Errorf("session.onboarded = %v, want false for a freshly created profile", session["onboarded"])
	}
	if _, ok := session["expiresAt"].(string); !ok {
		t.Errorf("session.expiresAt missing: %v", session)
	}

	tokens, ok := payload["tokens"].(map[string]any)
	if !ok {
		t.Fatalf("response has no tokens object: %v", payload)
	}
	if tokens["accessToken"] != "access-from-signup" || tokens["refreshToken"] != "refresh-from-signup" {
		t.Errorf("tokens = %v, want the pair Supabase returned", tokens)
	}
	if tokens["tokenType"] != "bearer" {
		t.Errorf("tokens.tokenType = %v, want bearer", tokens["tokenType"])
	}

	user, ok := payload["user"].(map[string]any)
	if !ok {
		t.Fatalf("response has no user object: %v", payload)
	}
	if user["emailConfirmed"] != true {
		t.Errorf("user.emailConfirmed = %v, want true", user["emailConfirmed"])
	}
}

func TestSignUpSucceedsWhileEmailConfirmationIsPending(t *testing.T) {
	// A project with email confirmation on returns a user and no session. That is
	// a created account, not an error, and the response says so by omitting the
	// tokens rather than inventing them.
	backend := &fakeBackend{signUpResult: supabaseauth.Result{User: testUser("player@example.com", "user", false)}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}

	payload := decode(t, response)
	if _, present := payload["tokens"]; present {
		t.Errorf("tokens were returned although Supabase created no session: %v", payload)
	}
	session := payload["session"].(map[string]any)
	if _, present := session["onboarded"]; present {
		t.Errorf("onboarded was reported although no token could read the profile: %v", session)
	}
}

func TestSignInReturnsTokensAndTheRoleFromTheToken(t *testing.T) {
	backend := &fakeBackend{
		signInResult: supabaseauth.Result{
			Session: sessionResult("access-1", "refresh-1").Session,
			User:    testUser("player@example.com", "moderator", true),
		},
		onboardedValue: true,
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignInPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}

	payload := decode(t, response)
	session := payload["session"].(map[string]any)
	if session["role"] != "moderator" {
		t.Errorf("session.role = %v, want the role Supabase put in app_metadata", session["role"])
	}
	if session["onboarded"] != true {
		t.Errorf("session.onboarded = %v, want true", session["onboarded"])
	}
	if payload["tokens"].(map[string]any)["accessToken"] != "access-1" {
		t.Errorf("tokens = %v, want the pair Supabase returned", payload["tokens"])
	}

	// The address reaches Supabase exactly as the caller typed it, trimmed.
	if got := backend.emailSeen(); got != "player@example.com" {
		t.Errorf("email sent to Supabase = %q", got)
	}
}

func TestRefreshRotatesTheTokenPair(t *testing.T) {
	backend := &fakeBackend{refreshResult: sessionResult("access-2", "refresh-2")}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, RefreshPath, `{"refreshToken":"refresh-1"}`, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}

	tokens := decode(t, response)["tokens"].(map[string]any)
	if tokens["accessToken"] != "access-2" || tokens["refreshToken"] != "refresh-2" {
		t.Errorf("tokens = %v, want the rotated pair", tokens)
	}
	if got := backend.refreshes(); len(got) != 1 || got[0] != "refresh-1" {
		t.Errorf("refresh tokens sent to Supabase = %v", got)
	}
}

// ── Failure mapping ─────────────────────────────────────────────────────────

func TestSignInWithInvalidCredentialsIsUnauthorized(t *testing.T) {
	backend := &fakeBackend{signInErr: &supabaseauth.Error{Op: "sign-in", Status: 400, Code: supabaseauth.CodeInvalidCredentials}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignInPath,
		`{"email":"player@example.com","password":"wrong-password"}`, nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if code := errorCode(t, response); code != "unauthorized" {
		t.Errorf("error code = %q, want unauthorized", code)
	}
}

func TestSignInTreatsALegacyInvalidGrantAsBadCredentials(t *testing.T) {
	// Older GoTrue deployments answer a wrong password with `invalid_grant`, the
	// code the modern API uses for a stale refresh token. The operation decides
	// the meaning, so a failed sign-in is 401 and never 5xx.
	backend := &fakeBackend{signInErr: &supabaseauth.Error{Op: "sign-in", Status: 400, Code: supabaseauth.CodeInvalidGrant}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignInPath,
		`{"email":"player@example.com","password":"wrong-password"}`, nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	response.Body.Close()
}

func TestSupabaseFailuresMapOntoPlatformCodes(t *testing.T) {
	cases := []struct {
		name       string
		code       string
		wantStatus int
		wantCode   string
	}{
		{"unconfirmed email", supabaseauth.CodeEmailNotConfirmed, http.StatusForbidden, "forbidden"},
		{"weak password", supabaseauth.CodeWeakPassword, http.StatusUnprocessableEntity, "unprocessable_entity"},
		{"validation failed", supabaseauth.CodeValidationFailed, http.StatusUnprocessableEntity, "unprocessable_entity"},
		{"supabase request rate limit", supabaseauth.CodeOverRequestRate, http.StatusTooManyRequests, "rate_limited"},
		{"supabase email rate limit", supabaseauth.CodeOverEmailRate, http.StatusTooManyRequests, "rate_limited"},
		{"an unrecognised code", "something_brand_new", http.StatusServiceUnavailable, "service_unavailable"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := &fakeBackend{signInErr: &supabaseauth.Error{Op: "sign-in", Status: 400, Code: testCase.code}}
			h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

			response := h.do(t, http.MethodPost, SignInPath,
				`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
			if response.StatusCode != testCase.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, testCase.wantStatus)
			}
			if got := errorCode(t, response); got != testCase.wantCode {
				t.Errorf("error code = %q, want %q", got, testCase.wantCode)
			}
		})
	}
}

func TestSignUpMapsAnExistingAccountToConflict(t *testing.T) {
	// Both shapes Supabase uses for an address that already has an account. The
	// answer must be the same: nothing was created, and signing in is the next
	// step — never a silent second registration.
	for _, supabaseCode := range []string{supabaseauth.CodeUserAlreadyExists, supabaseauth.CodeEmailExists} {
		backend := &fakeBackend{signUpErr: &supabaseauth.Error{Op: "sign-up", Status: 422, Code: supabaseCode}}
		h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

		response := h.do(t, http.MethodPost, SignUpPath,
			`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
		if response.StatusCode != http.StatusConflict {
			t.Fatalf("%s: status = %d, want 409", supabaseCode, response.StatusCode)
		}
		payload := decode(t, response)
		envelope, ok := payload["error"].(map[string]any)
		if !ok {
			t.Fatalf("%s: response has no error envelope: %v", supabaseCode, payload)
		}
		if code, _ := envelope["code"].(string); code != "conflict" {
			t.Errorf("%s: error code = %q, want conflict", supabaseCode, code)
		}
		if message, _ := envelope["message"].(string); message != "An account with this email already exists. Please sign in instead." {
			t.Errorf("%s: message = %q", supabaseCode, message)
		}
	}
}

// ── Sign-up usernames ───────────────────────────────────────────────────────

func TestSignUpPersistsTheChosenUsername(t *testing.T) {
	backend := &fakeBackend{
		usernameAvailable: true,
		signUpResult:      sessionResult("access-from-signup", "refresh-from-signup"),
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery","username":"  Rijad  "}`, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}
	response.Body.Close()

	// Normalized once, in one place: the form, the API and the trigger all see
	// the same lowercase spelling, which is what makes case-insensitive
	// uniqueness real rather than a database detail the client can dodge.
	if got := backend.signupName(); got != "rijad" {
		t.Errorf("username sent to Supabase = %q, want rijad", got)
	}
	checks := backend.usernameLookups()
	if len(checks) != 1 || checks[0] != "rijad" {
		t.Errorf("availability lookups = %v, want one for rijad", checks)
	}
}

func TestSignUpForwardsTheChosenDisplayName(t *testing.T) {
	backend := &fakeBackend{usernameAvailable: true}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery","username":"rijad","displayName":"  Rijad H  "}`, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}
	response.Body.Close()

	// The trigger stores it and marks the registration finished, so the
	// confirmation link does not lead back to the name step.
	backend.mu.Lock()
	got := backend.signUpDisplayName
	backend.mu.Unlock()
	if got != "Rijad H" {
		t.Errorf("display name sent to Supabase = %q, want %q", got, "Rijad H")
	}
}

func TestSignUpRejectsAnOverlongDisplayName(t *testing.T) {
	backend := &fakeBackend{usernameAvailable: true}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery","username":"rijad","displayName":"`+strings.Repeat("a", 61)+`"}`, nil)
	response.Body.Close()
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.StatusCode)
	}
	if backend.signupCalls() != 0 {
		t.Errorf("an account was created for a refused display name")
	}
}

func TestSignUpRejectsATakenUsernameBeforeCreatingAnAccount(t *testing.T) {
	backend := &fakeBackend{usernameAvailable: false}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery","username":"rijad"}`, nil)
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.StatusCode)
	}

	envelope := decode(t, response)["error"].(map[string]any)
	if envelope["code"] != "conflict" {
		t.Errorf("code = %v, want conflict", envelope["code"])
	}
	if envelope["message"] != "That username is taken. Choose another." {
		t.Errorf("message = %v", envelope["message"])
	}
	details, _ := envelope["details"].([]any)
	if len(details) == 0 {
		t.Fatalf("the refusal names no field: %v", envelope)
	}
	detail := details[0].(map[string]any)
	if detail["field"] != "username" || detail["rule"] != "taken" {
		t.Errorf("detail = %v, want username/taken", detail)
	}
	// Nothing was created: the account insert is never attempted for a name the
	// pre-flight check already refused.
	if backend.signupCalls() != 0 {
		t.Errorf("sign-up calls = %d, want none", backend.signupCalls())
	}
}

func TestSignUpRejectsAnInvalidUsernameBeforeSupabase(t *testing.T) {
	cases := map[string]struct {
		username string
		rule     string
	}{
		"too short":   {"ab", "length"},
		"too long":    {"a234567890123456789012345", "length"},
		"space":       {"rijad adil", "format"},
		"hyphen":      {"rijad-adil", "format"},
		"punctuation": {"rijad!", "format"},
	}

	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			backend := &fakeBackend{}
			h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

			response := h.do(t, http.MethodPost, SignUpPath,
				`{"email":"player@example.com","password":"correct-horse-battery","username":"`+testCase.username+`"}`, nil)
			if response.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", response.StatusCode)
			}

			envelope := decode(t, response)["error"].(map[string]any)
			details, _ := envelope["details"].([]any)
			if len(details) == 0 {
				t.Fatalf("error has no details: %v", envelope)
			}
			detail := details[0].(map[string]any)
			if detail["field"] != "username" || detail["rule"] != testCase.rule {
				t.Errorf("detail = %v, want username/%s", detail, testCase.rule)
			}
			if len(backend.usernameLookups()) != 0 || backend.signupCalls() != 0 {
				t.Error("an invalid username still reached Supabase")
			}
		})
	}
}

func TestSignUpMapsALostUsernameRaceToAFieldConflict(t *testing.T) {
	// The browser's check passed, then another registration claimed the name
	// between that check and the insert. The database's unique index refuses the
	// trigger's profile insert, which rolls the account back; the service
	// re-reads the name and answers the same 409 the form already understands.
	backend := &fakeBackend{
		usernameAnswers: []bool{true, false},
		signUpErr:       &supabaseauth.Error{Op: "sign-up", Status: http.StatusInternalServerError},
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery","username":"rijad"}`, nil)
	if response.StatusCode != http.StatusConflict {
		t.Fatalf("status = %d, want 409", response.StatusCode)
	}
	envelope := decode(t, response)["error"].(map[string]any)
	if envelope["code"] != "conflict" {
		t.Errorf("code = %v, want conflict", envelope["code"])
	}
	if backend.signupName() != "rijad" {
		t.Errorf("username sent to Supabase = %q", backend.signupName())
	}
	if checks := backend.usernameLookups(); len(checks) != 2 {
		t.Errorf("availability lookups = %v, want the pre-flight and the re-check", checks)
	}
}

func TestSignUpDoesNotCreateAnAccountWhenAvailabilityCannotBeChecked(t *testing.T) {
	backend := &fakeBackend{usernameErr: &supabaseauth.Error{Op: "username-available"}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery","username":"rijad"}`, nil)
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	envelope := decode(t, response)["error"].(map[string]any)
	if envelope["message"] != "Couldn't check username availability. Try again." {
		t.Errorf("message = %v", envelope["message"])
	}
	// Fail closed: an unanswered check is never permission to register.
	if backend.signupCalls() != 0 {
		t.Errorf("sign-up calls = %d, want none", backend.signupCalls())
	}
}

func TestUsernameAvailabilityAnswersOnlyABoolean(t *testing.T) {
	for _, available := range []bool{true, false} {
		t.Run(map[bool]string{true: "available", false: "taken"}[available], func(t *testing.T) {
			backend := &fakeBackend{usernameAvailable: available}
			h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

			response := h.get(t, UsernameAvailablePath+"?username=Rijad", "")
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want 200", response.StatusCode)
			}
			if got := response.Header.Get("Cache-Control"); got != "no-store" {
				t.Errorf("Cache-Control = %q, want no-store", got)
			}
			payload := decode(t, response)
			if payload["username"] != "rijad" || payload["available"] != available {
				t.Errorf("payload = %v, want the normalized name and %v", payload, available)
			}
			// Nothing beyond the answer: no id, display name or other profile row.
			if len(payload) != 2 {
				t.Errorf("payload carries more than availability: %v", payload)
			}
			checks := backend.usernameLookups()
			if len(checks) != 1 || checks[0] != "rijad" {
				t.Errorf("lookups = %v, want one normalized lookup", checks)
			}
		})
	}
}

func TestUsernameAvailabilityRejectsAMalformedName(t *testing.T) {
	cases := []string{"", "ab", "has space", "hyphen-name", strings.Repeat("a", 25)}
	for _, username := range cases {
		t.Run(username, func(t *testing.T) {
			backend := &fakeBackend{usernameAvailable: true}
			h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

			response := h.get(t, UsernameAvailablePath+"?username="+url.QueryEscape(username), "")
			if response.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", response.StatusCode)
			}
			envelope := decode(t, response)["error"].(map[string]any)
			details, _ := envelope["details"].([]any)
			if len(details) == 0 || details[0].(map[string]any)["field"] != "username" {
				t.Errorf("the refusal does not name the username field: %v", envelope)
			}
			if len(backend.usernameLookups()) != 0 {
				t.Error("a malformed username still reached Supabase")
			}
		})
	}
}

func TestUsernameAvailabilityReportsAFailedLookupWithoutCallingItAvailable(t *testing.T) {
	backend := &fakeBackend{usernameAvailable: true, usernameErr: &supabaseauth.Error{Op: "username-available"}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, UsernameAvailablePath+"?username=rijad", "")
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	envelope := decode(t, response)["error"].(map[string]any)
	if envelope["message"] != "Couldn't check username availability. Try again." {
		t.Errorf("message = %v", envelope["message"])
	}
}

func TestRateLimitedResponsesCarryRetryAfter(t *testing.T) {
	backend := &fakeBackend{signInErr: &supabaseauth.Error{Op: "sign-in", Status: 429, Code: supabaseauth.CodeOverRequestRate}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignInPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429", response.StatusCode)
	}
	if response.Header.Get("Retry-After") == "" {
		t.Error("429 response is missing Retry-After")
	}
	response.Body.Close()
}

func TestUpstreamFailureIsReportedAsUnavailableWithoutLeakingIt(t *testing.T) {
	// Status 0 is a call that never completed, the shape a transport failure has.
	backend := &fakeBackend{signInErr: &supabaseauth.Error{Op: "sign-in"}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignInPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}

	envelope := decode(t, response)["error"].(map[string]any)
	message, _ := envelope["message"].(string)
	for _, leaked := range []string{"dial tcp", "connection refused", "10.0.0.1", "supabase", "request failed"} {
		if strings.Contains(strings.ToLower(message), leaked) {
			t.Errorf("response message %q leaked upstream detail %q", message, leaked)
		}
	}
}

func TestRefreshWithAStaleTokenIsUnauthorized(t *testing.T) {
	for _, code := range []string{supabaseauth.CodeInvalidGrant, supabaseauth.CodeRefreshTokenMissing} {
		t.Run(code, func(t *testing.T) {
			backend := &fakeBackend{refreshErr: &supabaseauth.Error{Op: "refresh", Status: 400, Code: code}}
			h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

			response := h.do(t, http.MethodPost, RefreshPath, `{"refreshToken":"stale-refresh-token-value"}`, nil)
			if response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", response.StatusCode)
			}
			response.Body.Close()
		})
	}
}

// ── Session reads ───────────────────────────────────────────────────────────

func TestSessionReadRequiresAToken(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})

	response := h.get(t, SessionPath, "")
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	if got := response.Header.Get("WWW-Authenticate"); !strings.Contains(got, "Bearer") {
		t.Errorf("WWW-Authenticate = %q, want a Bearer challenge", got)
	}
	if code := errorCode(t, response); code != "unauthorized" {
		t.Errorf("error code = %q, want unauthorized", code)
	}
}

func TestSessionReadReportsTheVerifiedIdentity(t *testing.T) {
	backend := &fakeBackend{onboardedValue: true}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, SessionPath, validToken(t, map[string]any{"role": "admin"}))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}

	payload := decode(t, response)
	// The identity comes from the token, never from a header or query value.
	if payload["userId"] != testUserID {
		t.Errorf("userId = %v, want the token subject", payload["userId"])
	}
	if payload["role"] != "admin" {
		t.Errorf("role = %v, want admin from app_metadata", payload["role"])
	}
	if payload["email"] != "player@example.com" {
		t.Errorf("email = %v, want the token's email claim", payload["email"])
	}
	if payload["onboarded"] != true {
		t.Errorf("onboarded = %v, want true", payload["onboarded"])
	}
	if _, present := payload["tokens"]; present {
		t.Error("the session view must never carry a token")
	}
}

// legacyMarker is a profile the old sign-up flow created: the account predates
// the completion step, so the marker is null because nothing wrote one.
func legacyMarker(t *testing.T) *supabaseauth.User {
	t.Helper()
	return &supabaseauth.User{ID: testUserID, CreatedAt: signupCompletionCutoff.Add(-24 * time.Hour)}
}

func TestSessionReadTreatsALegacyNullMarkerAsRegistered(t *testing.T) {
	backend := &fakeBackend{userResult: *legacyMarker(t)}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, SessionPath, validToken(t, nil))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}

	payload := decode(t, response)
	if payload["onboarded"] != true {
		t.Errorf("onboarded = %v, want true for an account that predates the completion flow", payload["onboarded"])
	}

	// The repair is what makes later reads cheap; it must record the account's
	// own creation time, and the conditional filter must leave a real marker
	// alone.
	marks, markedAt := backend.marked()
	if marks != 1 {
		t.Fatalf("marker repairs = %d, want 1", marks)
	}
	if !markedAt[0].Equal(legacyMarker(t).CreatedAt) {
		t.Errorf("repaired marker = %s, want the account creation time", markedAt[0])
	}
}

func TestSessionReadSeesANewNullMarkerAsNotOnboarded(t *testing.T) {
	backend := &fakeBackend{
		userResult: supabaseauth.User{ID: testUserID, CreatedAt: signupCompletionCutoff.Add(time.Hour)},
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, SessionPath, validToken(t, nil))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}

	payload := decode(t, response)
	if payload["onboarded"] != false {
		t.Errorf("onboarded = %v, want false for an account that still has onboarding to finish", payload["onboarded"])
	}
	if marks, _ := backend.marked(); marks != 0 {
		t.Errorf("marker repairs = %d, want none for a new account", marks)
	}
}

func TestCompletedMarkerNeedsNoFurtherReads(t *testing.T) {
	backend := &fakeBackend{onboardedValue: true}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, SessionPath, validToken(t, nil))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if payload := decode(t, response); payload["onboarded"] != true {
		t.Errorf("onboarded = %v, want true", payload["onboarded"])
	}
	if reads := backend.userReads(); reads != 0 {
		t.Errorf("account creation reads = %d, want none when the marker answers", reads)
	}
	if marks, _ := backend.marked(); marks != 0 {
		t.Errorf("marker repairs = %d, want none when the marker answers", marks)
	}
}

func TestOnboardedStaysUnknownWhenTheAccountAgeCannotBeRead(t *testing.T) {
	// The marker is null and the account's creation time is unavailable. The
	// session is still valid; the one field nobody can answer is left out rather
	// than guessed as false and acted on.
	backend := &fakeBackend{userErr: &supabaseauth.Error{Op: "user", Status: http.StatusInternalServerError}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, SessionPath, validToken(t, nil))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	session := decode(t, response)
	if _, present := session["onboarded"]; present {
		t.Errorf("onboarded was guessed although the account age could not be read: %v", session)
	}
	if marks, _ := backend.marked(); marks != 0 {
		t.Errorf("marker repairs = %d, want none without a creation time", marks)
	}
}

func TestMissingProfileIsUnknownEvenWhenTheAccountIsOld(t *testing.T) {
	// No profile row is a data gap, not "not onboarded": reading the age cannot
	// repair a row that does not exist, and false would send the account back
	// through sign-up only to dead-end at the completion write.
	backend := &fakeBackend{
		onboardedErr: &supabaseauth.Error{Op: "profile", Status: http.StatusOK},
		userResult:   *legacyMarker(t),
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.get(t, SessionPath, validToken(t, nil))
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	session := decode(t, response)
	if _, present := session["onboarded"]; present {
		t.Errorf("onboarded was reported for an account with no profile row: %v", session)
	}
	if reads := backend.userReads(); reads != 0 {
		t.Errorf("account creation reads = %d, want none after the profile read failed", reads)
	}
	if marks, _ := backend.marked(); marks != 0 {
		t.Errorf("marker repairs = %d, want none after the profile read failed", marks)
	}
}

func TestALegacyMarkerRepairThatFailsStillAnswers(t *testing.T) {
	// The repair is an optimisation. If it is refused, the account is still
	// registered; the only cost is deriving the answer again on the next read.
	backend := &fakeBackend{
		userResult:       *legacyMarker(t),
		markOnboardedErr: &supabaseauth.Error{Op: "onboarded", Status: http.StatusForbidden},
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	payload := decode(t, h.get(t, SessionPath, validToken(t, nil)))
	if payload["onboarded"] != true {
		t.Errorf("onboarded = %v, want true even when the marker could not be repaired", payload["onboarded"])
	}
}

func TestSignInMarksALegacyAccountWithoutASecondAgeRead(t *testing.T) {
	// Sign-in already returns the user record, so the age check must use it
	// instead of spending another Supabase call.
	createdAt := signupCompletionCutoff.Add(-time.Hour)
	backend := &fakeBackend{
		signInResult: supabaseauth.Result{
			Session: sessionResult("access-1", "refresh-1").Session,
			User:    &supabaseauth.User{ID: testUserID, CreatedAt: createdAt},
		},
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignInPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	session := decode(t, response)["session"].(map[string]any)
	if session["onboarded"] != true {
		t.Errorf("session.onboarded = %v, want true for a legacy account", session["onboarded"])
	}
	if reads := backend.userReads(); reads != 0 {
		t.Errorf("account creation reads = %d, want none when sign-in supplied the record", reads)
	}
	if marks, markedAt := backend.marked(); marks != 1 || !markedAt[0].Equal(createdAt) {
		t.Errorf("marker repairs = %d at %v, want one at the sign-in's creation time", marks, markedAt)
	}
}

func TestSignUpDoesNotMarkANewAccount(t *testing.T) {
	backend := &fakeBackend{signUpResult: sessionResult("access-from-signup", "refresh-from-signup")}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignUpPath,
		`{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if response.StatusCode != http.StatusCreated {
		t.Fatalf("status = %d, want 201", response.StatusCode)
	}
	session := decode(t, response)["session"].(map[string]any)
	if session["onboarded"] != false {
		t.Errorf("session.onboarded = %v, want false for a freshly created account", session["onboarded"])
	}
	if marks, _ := backend.marked(); marks != 0 {
		t.Errorf("marker repairs = %d, want none for an account created now", marks)
	}
	if reads := backend.userReads(); reads != 0 {
		t.Errorf("account creation reads = %d, want none when sign-up supplied the record", reads)
	}
}

func TestSessionReadRejectsUnusableTokens(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})

	forged, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": testUserID,
		"aud": "authenticated",
		"iat": time.Now().Add(-time.Minute).Unix(),
		"exp": time.Now().Add(time.Hour).Unix(),
	}).SignedString([]byte("a-different-secret-that-is-long-enough-000000"))
	if err != nil {
		t.Fatalf("signing forged token: %v", err)
	}

	cases := map[string]string{
		"expired": jwtFor(t, testUserID, time.Now().Add(-time.Hour), nil),
		"forged":  forged,
		// The service role key bypasses row-level security, so a valid signature
		// on it is not enough: the claim itself is refused.
		"service role":      serverKeyToken(t, "service_role"),
		"anonymous key":     serverKeyToken(t, "anon"),
		"unsigned":          "not-a-jwt-at-all",
		"not a token shape": strings.Repeat("a", 64),
	}
	for name, accessToken := range cases {
		t.Run(name, func(t *testing.T) {
			response := h.get(t, SessionPath, accessToken)
			if response.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %d, want 401", response.StatusCode)
			}
			response.Body.Close()
		})
	}
}

func TestSessionReadIgnoresAnUnknownAppMetadataRole(t *testing.T) {
	// app_metadata.role is a platform role, and only the three known values are
	// honoured. Anything else narrows to `user` instead of widening access.
	for _, raw := range []string{"service_role", "superuser", "admin ", "ADMIN"} {
		t.Run(raw, func(t *testing.T) {
			h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})
			response := h.get(t, SessionPath, validToken(t, map[string]any{"role": raw}))
			if response.StatusCode != http.StatusOK {
				t.Fatalf("status = %d, want 200", response.StatusCode)
			}
			payload := decode(t, response)
			want := identity.RoleUser
			if strings.TrimSpace(strings.ToLower(raw)) == identity.RoleAdmin {
				want = identity.RoleAdmin
			}
			if payload["role"] != want {
				t.Errorf("role = %v, want %v", payload["role"], want)
			}
		})
	}
}

func TestSessionReadFailsClosedWithoutAuthMaterial(t *testing.T) {
	// No verifier: "cannot verify" must not become "allow". A token presented to
	// a service with no auth material is 503 — not 401, and never 200.
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}})

	response := h.get(t, SessionPath, strings.Repeat("x", 64))
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if code := errorCode(t, response); code != "service_unavailable" {
		t.Errorf("error code = %q, want service_unavailable", code)
	}
}

func TestExchangeSessionVerifiesTheTokenInTheBody(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{onboardedValue: true}, withAuth: true})

	good := validToken(t, nil)
	response := h.do(t, http.MethodPost, SessionPath, `{"accessToken":"`+good+`"}`, nil)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", response.StatusCode)
	}
	if payload := decode(t, response); payload["userId"] != testUserID {
		t.Errorf("userId = %v, want the subject of the exchanged token", payload["userId"])
	}

	expired := jwtFor(t, testUserID, time.Now().Add(-time.Hour), nil)
	rejected := h.do(t, http.MethodPost, SessionPath, `{"accessToken":"`+expired+`"}`, nil)
	if rejected.StatusCode != http.StatusUnauthorized {
		t.Fatalf("expired token in the body = %d, want 401", rejected.StatusCode)
	}
	rejected.Body.Close()
}

func TestExchangeSessionRejectsAMissingToken(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})

	response := h.do(t, http.MethodPost, SessionPath, `{"accessToken":""}`, nil)
	if response.StatusCode != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", response.StatusCode)
	}
	if code := errorCode(t, response); code != "unprocessable_entity" {
		t.Errorf("error code = %q, want unprocessable_entity", code)
	}
}

// ── Sign-out ────────────────────────────────────────────────────────────────

func TestSignOutRevokesThePresentedSession(t *testing.T) {
	backend := &fakeBackend{}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	accessToken := validToken(t, nil)
	response := h.do(t, http.MethodPost, SignOutPath, "", map[string]string{"Authorization": "Bearer " + accessToken})
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", response.StatusCode)
	}
	response.Body.Close()

	signOuts := backend.signOuts()
	if len(signOuts) != 1 {
		t.Fatalf("Supabase sign-out calls = %d, want 1", len(signOuts))
	}
	if signOuts[0] != accessToken {
		t.Error("the session Supabase revoked is not the one the caller presented")
	}

	// A client that retries a sign-out must not be told it failed: the session is
	// already revoked, and an error would leave it holding a token it cannot use.
	again := h.do(t, http.MethodPost, SignOutPath, "", map[string]string{"Authorization": "Bearer " + accessToken})
	if again.StatusCode != http.StatusNoContent {
		t.Fatalf("retried sign-out = %d, want 204", again.StatusCode)
	}
	again.Body.Close()
}

func TestSignOutRequiresAToken(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})

	response := h.do(t, http.MethodPost, SignOutPath, "", nil)
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", response.StatusCode)
	}
	response.Body.Close()
}

func TestSignOutRefusesToPretendWhenSupabaseIsUnreachable(t *testing.T) {
	// Revoking is the whole point of signing out, so a service that cannot reach
	// Supabase must not answer 204 and leave the session live.
	h := newHarness(t, harnessOptions{withAuth: true})

	response := h.do(t, http.MethodPost, SignOutPath, "", map[string]string{"Authorization": "Bearer " + validToken(t, nil)})
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	if code := errorCode(t, response); code != "service_unavailable" {
		t.Errorf("error code = %q, want service_unavailable", code)
	}
}

func TestSignOutLetsASupabaseFailurePropagate(t *testing.T) {
	backend := &fakeBackend{signOutErr: &supabaseauth.Error{Op: "sign-out", Status: 500}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	response := h.do(t, http.MethodPost, SignOutPath, "", map[string]string{"Authorization": "Bearer " + validToken(t, nil)})
	if response.StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", response.StatusCode)
	}
	response.Body.Close()
}

// ── Malformed and invalid input ─────────────────────────────────────────────

func TestMalformedBodiesAreRejected(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})

	cases := []struct {
		name        string
		body        string
		contentType string
		wantStatus  int
		wantCode    string
	}{
		{"not JSON", `{"email":`, "application/json", http.StatusBadRequest, "bad_request"},
		{"unknown field", `{"email":"a@b.com","password":"correct-horse","admin":true}`, "application/json", http.StatusBadRequest, "bad_request"},
		{"wrong type", `{"email":42,"password":"correct-horse"}`, "application/json", http.StatusBadRequest, "bad_request"},
		{"empty body", ``, "", http.StatusBadRequest, "bad_request"},
		{"non-JSON content type", `{"email":"a@b.com","password":"correct-horse"}`, "text/plain", http.StatusUnsupportedMediaType, "unsupported_media_type"},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			headers := map[string]string{}
			if testCase.contentType != "" {
				headers["Content-Type"] = testCase.contentType
			}
			response := h.do(t, http.MethodPost, SignInPath, testCase.body, headers)
			if response.StatusCode != testCase.wantStatus {
				t.Fatalf("status = %d, want %d", response.StatusCode, testCase.wantStatus)
			}
			if got := errorCode(t, response); got != testCase.wantCode {
				t.Errorf("error code = %q, want %q", got, testCase.wantCode)
			}
		})
	}
}

func TestInvalidCredentialsInputIsRejectedBeforeSupabase(t *testing.T) {
	cases := []struct {
		name  string
		path  string
		body  string
		field string
	}{
		{"no at sign", SignInPath, `{"email":"player.example.com","password":"correct-horse"}`, "email"},
		{"display name form", SignInPath, `{"email":"Ada <ada@example.com>","password":"correct-horse"}`, "email"},
		{"missing email", SignInPath, `{"email":"","password":"correct-horse"}`, "email"},
		{"missing password", SignInPath, `{"email":"player@example.com","password":""}`, "password"},
		{"short password", SignUpPath, `{"email":"player@example.com","password":"short"}`, "password"},
		{
			// bcrypt ignores everything past 72 bytes, so a longer password would
			// be weaker than it looks. It is refused rather than truncated.
			"password longer than bcrypt can hash",
			SignUpPath,
			`{"email":"player@example.com","password":"` + strings.Repeat("a", maxPasswordBytes+1) + `"}`,
			"password",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			backend := &fakeBackend{}
			h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

			response := h.do(t, http.MethodPost, testCase.path, testCase.body, nil)
			if response.StatusCode != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", response.StatusCode)
			}

			envelope := decode(t, response)["error"].(map[string]any)
			details, _ := envelope["details"].([]any)
			if len(details) == 0 {
				t.Fatalf("error has no details: %v", envelope)
			}
			detail, _ := details[0].(map[string]any)
			if detail["field"] != testCase.field {
				t.Errorf("detail.field = %v, want %v", detail["field"], testCase.field)
			}
			// Nothing reached Supabase: invalid input never costs a round trip.
			if backend.onboardedReads() != 0 {
				t.Error("an invalid request still read a profile")
			}
			if backend.emailSeen() != "" {
				t.Error("an invalid request still called Supabase")
			}
		})
	}
}

func TestOversizedCredentialBodyIsRejected(t *testing.T) {
	h := newHarness(t, harnessOptions{backend: &fakeBackend{}, withAuth: true})

	body := `{"email":"player@example.com","password":"` + strings.Repeat("a", maxCredentialsBytes) + `"}`
	response := h.do(t, http.MethodPost, SignInPath, body, nil)
	if response.StatusCode != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", response.StatusCode)
	}
	if code := errorCode(t, response); code != "payload_too_large" {
		t.Errorf("error code = %q, want payload_too_large", code)
	}
}

// ── Rate limiting ───────────────────────────────────────────────────────────

func TestCredentialAttemptsAreThrottled(t *testing.T) {
	credentials := httpx.NewRateLimiter(config.RateLimit{Enabled: true, RequestsPerMinute: 1, Burst: 1})
	backend := &fakeBackend{signInErr: &supabaseauth.Error{Op: "sign-in", Status: 400, Code: supabaseauth.CodeInvalidCredentials}}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true, credentials: credentials})

	first := h.do(t, http.MethodPost, SignInPath, `{"email":"player@example.com","password":"wrong-password"}`, nil)
	if first.StatusCode != http.StatusUnauthorized {
		t.Fatalf("first attempt = %d, want 401", first.StatusCode)
	}
	first.Body.Close()

	second := h.do(t, http.MethodPost, SignInPath, `{"email":"player@example.com","password":"wrong-password"}`, nil)
	if second.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second attempt = %d, want 429", second.StatusCode)
	}
	if second.Header.Get("Retry-After") == "" {
		t.Error("429 response is missing Retry-After")
	}
	if code := errorCode(t, second); code != "rate_limited" {
		t.Errorf("error code = %q, want rate_limited", code)
	}
}

func TestThrottlingCredentialsDoesNotBlockTheRestOfTheAPI(t *testing.T) {
	// The credential bucket is separate from the API-wide one, so guessing
	// passwords cannot take the whole surface down with it.
	credentials := httpx.NewRateLimiter(config.RateLimit{Enabled: true, RequestsPerMinute: 1, Burst: 1})
	h := newHarness(t, harnessOptions{
		backend:     &fakeBackend{onboardedValue: true},
		withAuth:    true,
		credentials: credentials,
	})

	spent := h.do(t, http.MethodPost, SignInPath, `{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if spent.StatusCode != http.StatusOK {
		t.Fatalf("first sign-in = %d, want 200", spent.StatusCode)
	}
	spent.Body.Close()

	throttled := h.do(t, http.MethodPost, SignInPath, `{"email":"player@example.com","password":"correct-horse-battery"}`, nil)
	if throttled.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("second sign-in = %d, want 429", throttled.StatusCode)
	}
	throttled.Body.Close()

	// Endpoints metered only by the shared bucket still work.
	session := h.get(t, SessionPath, validToken(t, nil))
	if session.StatusCode != http.StatusOK {
		t.Fatalf("session read while credentials are throttled = %d, want 200", session.StatusCode)
	}
	session.Body.Close()

	health := h.get(t, httpx.HealthPath, "")
	if health.StatusCode != http.StatusOK {
		t.Fatalf("health while credentials are throttled = %d, want 200", health.StatusCode)
	}
	health.Body.Close()
}

func TestAccountBucketKeyIgnoresCaseAndWhitespace(t *testing.T) {
	// Supabase lowercases addresses, so the limiter must too, or an attacker gets
	// a fresh budget by changing the case.
	if supabaseauth.EscapeEmail(" Player@Example.com ") != supabaseauth.EscapeEmail("player@example.com") {
		t.Error("the account limiter key is case- or whitespace-sensitive")
	}
	if supabaseauth.EscapeEmail("a@example.com") == supabaseauth.EscapeEmail("b@example.com") {
		t.Error("two different addresses share one limiter key")
	}
}

func TestCredentialBudgetIsTighterThanTheSharedOne(t *testing.T) {
	limit := credentialRateLimit()
	if limit.RequestsPerMinute >= 60 {
		t.Errorf("the credential budget is %d per minute, which is no brake on password guessing", limit.RequestsPerMinute)
	}
	if limit.Burst <= 0 || limit.Burst > limit.RequestsPerMinute {
		t.Errorf("the credential burst is %d, which is not a small allowance above %d per minute", limit.Burst, limit.RequestsPerMinute)
	}
	if !limit.Enabled {
		t.Error("the credential bucket is disabled")
	}
}

// ── Log safety ──────────────────────────────────────────────────────────────

func TestSecretsNeverReachTheLogs(t *testing.T) {
	const (
		password = "correct-horse-battery-staple"
		access   = "access-token-that-must-not-be-logged"
		refresh  = "refresh-token-that-must-not-be-logged"
	)

	backend := &fakeBackend{
		signInResult:  sessionResult(access, refresh),
		refreshResult: sessionResult(access, refresh),
		onboardedErr:  &supabaseauth.Error{Op: "profile", Status: 500, Code: "internal_error"},
		signOutErr:    &supabaseauth.Error{Op: "sign-out"},
	}
	h := newHarness(t, harnessOptions{backend: backend, withAuth: true})

	h.send(t, http.MethodPost, SignInPath, `{"email":"player@example.com","password":"`+password+`"}`, "")
	h.send(t, http.MethodPost, RefreshPath, `{"refreshToken":"`+refresh+`"}`, "")
	// A rejected sign-in, a rejected refresh token and an unreachable Supabase are
	// the paths most likely to log something they should not.
	h.send(t, http.MethodPost, SignInPath, `{"email":"player@example.com","password":"`+password+`"}`, "")
	h.send(t, http.MethodGet, SessionPath, "", validToken(t, nil))
	h.send(t, http.MethodPost, SignOutPath, "", validToken(t, nil))

	logged := h.logs.String()
	if logged == "" {
		t.Fatal("no log output was captured, so this test proves nothing")
	}
	for name, secret := range map[string]string{
		"password":       password,
		"access token":   access,
		"refresh token":  refresh,
		"the JWT secret": testSecret,
	} {
		if strings.Contains(logged, secret) {
			t.Errorf("the %s appeared in the logs", name)
		}
	}
}

// ── Wiring ──────────────────────────────────────────────────────────────────

func TestOptionsMountsTheAuthRoutesAndFailsClosedWithoutSupabase(t *testing.T) {
	// The production entrypoint. Without SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY
	// the handlers must still be mounted and answer 503 — never 404, which would
	// look like a routing bug, and never 200.
	h := newHarness(t, harnessOptions{
		withAuth: true,
		registerWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, verifier *authn.Verifier) {
			options := Options()
			if options.Name != Name {
				t.Errorf("Options().Name = %q, want %q", options.Name, Name)
			}
			if options.RegisterWith == nil {
				t.Fatal("Options() exposes no RegisterWith wiring")
			}
			if len(options.ExtraLimiters) != 1 {
				t.Errorf("Options() exposes %d credential limiters, want 1", len(options.ExtraLimiters))
			}
			options.RegisterWith(router, cfg, logger, verifier)
		},
	})

	credentialBodies := map[string]string{
		SignUpPath:  `{"email":"player@example.com","password":"correct-horse-battery"}`,
		SignInPath:  `{"email":"player@example.com","password":"correct-horse-battery"}`,
		RefreshPath: `{"refreshToken":"some-refresh-token-value"}`,
	}
	for path, body := range credentialBodies {
		response := h.do(t, http.MethodPost, path, body, nil)
		if response.StatusCode != http.StatusServiceUnavailable {
			t.Fatalf("%s without Supabase configuration = %d, want 503", path, response.StatusCode)
		}
		if code := errorCode(t, response); code != "service_unavailable" {
			t.Errorf("%s error code = %q, want service_unavailable", path, code)
		}
	}

	// The session routes are mounted too, and verify before they answer: a body
	// token that is not a token is 401, and no header token is 401.
	exchange := h.do(t, http.MethodPost, SessionPath, `{"accessToken":"`+strings.Repeat("a", 64)+`"}`, nil)
	if exchange.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST %s = %d, want 401", SessionPath, exchange.StatusCode)
	}
	exchange.Body.Close()

	session := h.get(t, SessionPath, "")
	if session.StatusCode != http.StatusUnauthorized {
		t.Fatalf("GET %s = %d, want 401", SessionPath, session.StatusCode)
	}
	session.Body.Close()

	signOut := h.do(t, http.MethodPost, SignOutPath, "", nil)
	if signOut.StatusCode != http.StatusUnauthorized {
		t.Fatalf("POST %s = %d, want 401", SignOutPath, signOut.StatusCode)
	}
	signOut.Body.Close()
}
