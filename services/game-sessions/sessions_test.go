package gamesessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/game-sessions/internal/supabaseplay"
)

// testSecret must be at least 32 characters; the verifier refuses shorter ones.
const testSecret = "test-secret-used-only-in-unit-tests-0123456789"

const (
	sessionID           = "cccccccc-1111-4111-8111-cccccccccccc"
	theSeed             = "9223372036854775807"
	greedyRun           = "[0,0,1,0,0,0,2,2,2,3,0,0,0,0]"
	rulesVersion        = "stack-10@1"
	stack10EndlessRules = "stack-10@2"
	// Seed 1's first pattern is one cell, then two: a rebuilt pattern and a
	// losing tap, for ten points and one cleared round.
	memoryFlashRules        = "memory-flash@1"
	memoryFlashEndlessRules = "memory-flash@2"
	memoryFlashRun          = "[8,8,0]"
	// Seed 1's first board wins on cell 7; the second tap misses, for ten points
	// and one restored board.
	oneMoveRules        = "one-move@1"
	oneMoveEndlessRules = "one-move@2"
	oneMoveRun          = "[7,0]"
	// Seed 1 opens with two shade-1 tiles side by side: sliding left merges them
	// for four points, and the next slide deals another tile.
	colorMergeRules        = "color-merge@1"
	colorMergeEndlessRules = "color-merge@2"
	colorMergeRun          = "[3,2]"
	// Seed 1's opening row is black, black, white: clearing the white and then
	// touching the black scores ten and ends the run with both taps submitted.
	dontTouchRules        = "dont-touch@1"
	dontTouchEndlessRules = "dont-touch@2"
	dontTouchRun          = "[2,0]"
	// Seed 1's first four challenges each have one right button: 0, 0, 2, 1.
	// Answering 0, 1, 2, 1 clears three of them for thirty points.
	sevenSecondRules = "seven-second@1"
	sevenSecondRun   = "[0,1,2,1]"
	// Seed 1's first board is solved by cells 1, 8, 10, 19 and 22, each tapped
	// twice: an X, then a Queen. Fifty points and one solved board.
	queensRules = "queens@1"
	queensRun   = "[1,1,8,8,10,10,19,19,22,22]"
	// Seed 1's first Zip board is solved by one path through all twenty-five
	// cells: fifty points and one solved board.
	zipRules   = "zip@1"
	zipRun     = "[8,7,6,5,10,15,20,21,16,11,12,17,22,23,24,19,18,13,14,9,4,3,2,1,0]"
	testUserID = "3f7c2b1e-4d5a-4c9b-8e2f-1a2b3c4d5e6f"
)

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

// fakeBackend stands in for the play client. It returns what it was given and
// records what it was asked for, so a test asserts the request the handler made
// as well as the response it rendered.
type fakeBackend struct {
	start    supabaseplay.Start
	startErr error
	result   supabaseplay.Result
	runErr   error

	lastStart supabaseplay.StartRequest
	lastRun   supabaseplay.CompleteRequest
	runCalls  int
}

func (b *fakeBackend) StartSession(_ context.Context, request supabaseplay.StartRequest) (supabaseplay.Start, error) {
	b.lastStart = request
	if b.startErr != nil {
		return supabaseplay.Start{}, b.startErr
	}
	start := b.start
	// The database answers `ranked` from whether the caller presented a token,
	// so the fake does the same: it is the property the handler must pass on
	// rather than re-derive.
	start.Ranked = request.AccessToken != ""
	return start, nil
}

func (b *fakeBackend) CompleteRun(_ context.Context, request supabaseplay.CompleteRequest) (supabaseplay.Result, error) {
	b.runCalls++
	b.lastRun = request
	if b.runErr != nil {
		return supabaseplay.Result{}, b.runErr
	}
	return b.result, nil
}

func testBackend() *fakeBackend {
	started := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	return &fakeBackend{
		start: supabaseplay.Start{
			Outcome:      "started",
			ID:           sessionID,
			GameSlug:     "stack-10",
			RulesVersion: rulesVersion,
			Seed:         theSeed,
			TileCount:    60,
			StartedAt:    started,
			ExpiresAt:    started.Add(2 * time.Hour),
			Ranked:       true,
		},
		result: supabaseplay.Result{
			Outcome:        "recorded",
			SessionID:      sessionID,
			GameSlug:       "stack-10",
			Score:          ptr(int64(55)),
			ClearedColumns: ptr(3),
			TilesPlaced:    ptr(14),
			DurationMS:     ptr(45000),
			Ranked:         ptr(true),
			RecordedAt:     &started,
			PersonalBest:   ptr(int64(55)),
			Rank:           ptr(int64(1)),
		},
	}
}

func ptr[T any](value T) *T { return &value }

// testServer serves the session routes exactly as production does, including the
// real token verifier and Go's method+pattern routing (which is what makes
// `{sessionID}` resolvable). The verifier matters here: the caller's own token is
// the credential that makes a run ranked, so a harness that could not verify one
// would be testing a different service.
func testServer(t *testing.T, backend Backend) *httptest.Server {
	t.Helper()

	t.Setenv("ENVIRONMENT", "development")
	t.Setenv("SUPABASE_JWT_SECRET", testSecret)
	t.Setenv("SUPABASE_JWT_AUDIENCE", "authenticated")

	cfg, err := config.Load("game-sessions-test")
	if err != nil {
		t.Fatalf("loading test configuration: %v", err)
	}
	verifier, err := authn.NewVerifier(cfg)
	if err != nil {
		t.Fatalf("building verifier: %v", err)
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := httpx.NewRouter(httpx.RouterOptions{Config: cfg, Verifier: verifier, Logger: logger})
	newService(backend, logger).register(router)

	server := httptest.NewServer(router.Mux())
	t.Cleanup(server.Close)
	return server
}

// post performs a request and returns the status plus the decoded body. The
// caller's token is passed as a header, which is the only way this service ever
// learns who is playing.
func post(t *testing.T, server *httptest.Server, path, body, token string) (int, map[string]any) {
	t.Helper()
	request, err := http.NewRequest(http.MethodPost, server.URL+path, strings.NewReader(body))
	if err != nil {
		t.Fatalf("building POST %s: %v", path, err)
	}
	request.Header.Set("Content-Type", "application/json")
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatalf("reading body: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decoding %s body %q: %v", path, raw, err)
	}
	return response.StatusCode, decoded
}

func startBody(slug, rules string) string {
	return `{"gameSlug":"` + slug + `","rulesVersion":"` + rules + `","client":"web/1.0"}`
}

func completeBody(score, duration, actions string) string {
	return completeBodyRules(rulesVersion, score, duration, actions)
}

func completeBodyRules(rules, score, duration, actions string) string {
	return `{"score":` + score + `,"durationMs":` + duration +
		`,"progress":{"rulesVersion":"` + rules + `","actions":` + actions + `}}`
}

func errorCode(t *testing.T, body map[string]any) string {
	t.Helper()
	failure, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("body has no error envelope: %#v", body)
	}
	code, _ := failure["code"].(string)
	return code
}

// ── Starting a run ──────────────────────────────────────────────────────────

func TestStartSessionIssuesARun(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server, "/api/v1/sessions", startBody("stack-10", rulesVersion), "")

	if status != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%#v)", status, body)
	}
	if body["id"] != sessionID || body["gameSlug"] != "stack-10" {
		t.Fatalf("body = %#v, want the issued session", body)
	}
	// The seed has to survive JSON intact: a rounded one would have the client
	// playing a different deck than the verifier replays.
	if body["seed"] != theSeed {
		t.Fatalf("seed = %v, want the exact decimal string %s", body["seed"], theSeed)
	}
	if body["tileCount"] != float64(60) || body["ranked"] != false {
		t.Fatalf("body = %#v, want 60 tiles and an unranked guest run", body)
	}
	if backend.lastStart.GameSlug != "stack-10" || backend.lastStart.RulesVersion != rulesVersion {
		t.Fatalf("backend asked for %+v", backend.lastStart)
	}
	// No token in, no token out: this is what makes the run anonymous.
	if backend.lastStart.AccessToken != "" {
		t.Fatal("an anonymous request must not carry a token to the database")
	}
}

func TestStartSessionForwardsTheCallersToken(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)
	signed := token(t, testUserID)

	status, body := post(t, server, "/api/v1/sessions", startBody("stack-10", rulesVersion), signed)
	if status != http.StatusCreated {
		t.Fatalf("status = %d, want 201 (%#v)", status, body)
	}
	// The token is the whole credential: the database decides who is playing
	// from it, and the service never names a user itself.
	if backend.lastStart.AccessToken != signed {
		t.Fatalf("access token = %q, want the caller's own", backend.lastStart.AccessToken)
	}
	// A signed-in run is eligible for a score, and the database's own answer is
	// what the response reports.
	if body["ranked"] != true {
		t.Fatalf("ranked = %v, want true for a signed-in player", body["ranked"])
	}
}

func TestStartSessionRefusesAGameThatCannotBePlayed(t *testing.T) {
	backend := testBackend()
	backend.start = supabaseplay.Start{Outcome: "not_playable"}
	server := testServer(t, backend)

	status, body := post(t, server, "/api/v1/sessions", startBody("color-merge", rulesVersion), "")

	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
	if errorCode(t, body) != "not_found" {
		t.Fatalf("code = %s, want not_found", errorCode(t, body))
	}
}

func TestStartSessionRefusesRulesItCannotVerify(t *testing.T) {
	backend := testBackend()
	backend.start = supabaseplay.Start{Outcome: "unsupported_runtime"}
	server := testServer(t, backend)

	status, body := post(t, server, "/api/v1/sessions", startBody("stack-10", "stack-10@3"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", status)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
}

func TestStartSessionRejectsAMalformedRequest(t *testing.T) {
	cases := map[string]string{
		"a slug that is not a slug":     startBody("Stack 10", rulesVersion),
		"a rules version without a tag": startBody("stack-10", "stack-10"),
		"an unknown field":              `{"gameSlug":"stack-10","rulesVersion":"stack-10@1","seed":1}`,
		"a number where a string goes":  `{"gameSlug":10,"rulesVersion":"stack-10@1"}`,
		"a client that is too long":     `{"gameSlug":"stack-10","rulesVersion":"stack-10@1","client":"` + strings.Repeat("x", 41) + `"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			backend := testBackend()
			server := testServer(t, backend)

			status, decoded := post(t, server, "/api/v1/sessions", body, "")

			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%#v)", status, decoded)
			}
			if errorCode(t, decoded) != "bad_request" {
				t.Fatalf("code = %s, want bad_request", errorCode(t, decoded))
			}
			// A rejected request must never have reached the database: a seed
			// that exists for a request nobody may make is still a row.
			if backend.lastStart.GameSlug != "" {
				t.Fatalf("the backend was called with %+v", backend.lastStart)
			}
		})
	}
}

func TestStartSessionAnswersServiceUnavailableWithoutAClient(t *testing.T) {
	server := testServer(t, nil)

	status, body := post(t, server, "/api/v1/sessions", startBody("stack-10", rulesVersion), "")

	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	if errorCode(t, body) != "service_unavailable" {
		t.Fatalf("code = %s, want service_unavailable", errorCode(t, body))
	}
}

func TestStartSessionAnswersServiceUnavailableWhenTheDatabaseFails(t *testing.T) {
	backend := testBackend()
	backend.startErr = errors.New("connection refused")
	server := testServer(t, backend)

	status, body := post(t, server, "/api/v1/sessions", startBody("stack-10", rulesVersion), "")

	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	// The upstream error must not reach the caller, but it must be a service
	// failure rather than a 404 that suggests the game does not exist.
	if body["message"] == "connection refused" {
		t.Fatal("the transport error leaked into the response")
	}
}

// ── Submitting a run ────────────────────────────────────────────────────────

func TestCompleteSessionReturnsTheVerifiedScore(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	signed := token(t, testUserID)
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), signed)

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(55) || body["clearedColumns"] != float64(3) || body["tilesPlaced"] != float64(14) {
		t.Fatalf("body = %#v, want the derived numbers", body)
	}
	if body["ranked"] != true || body["duplicate"] != false {
		t.Fatalf("body = %#v, want a ranked, first-time submission", body)
	}
	if body["rank"] != float64(1) || body["personalBest"] != float64(55) {
		t.Fatalf("body = %#v, want the real rank and best", body)
	}
	if backend.lastRun.SessionID != sessionID || backend.lastRun.Score != 55 || backend.lastRun.DurationMS != 45000 {
		t.Fatalf("backend received %+v", backend.lastRun)
	}
	if backend.lastRun.AccessToken != signed {
		t.Fatalf("access token = %q, want the caller's own", backend.lastRun.AccessToken)
	}
	if len(backend.lastRun.Actions) != 14 || backend.lastRun.Actions[2] != 1 {
		t.Fatalf("actions = %v, want the submitted run", backend.lastRun.Actions)
	}
}

func TestCompleteSessionReportsARetryAsADuplicate(t *testing.T) {
	backend := testBackend()
	backend.result.Outcome = "duplicate"
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), "")

	// A retry is the same answer with a different fact about the request: the
	// client must be able to repeat a submission safely, and to know it did.
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if body["duplicate"] != true || body["score"] != float64(55) {
		t.Fatalf("body = %#v, want the recorded score marked as a duplicate", body)
	}
}

func TestCompleteSessionMapsEveryRefusal(t *testing.T) {
	cases := []struct {
		outcome string
		status  int
		code    string
		why     string
	}{
		{"not_found", http.StatusNotFound, "not_found", "a missing run and somebody else's run are one answer"},
		{"expired", http.StatusConflict, "conflict", "a run that outlived its window cannot be scored"},
		{"abandoned", http.StatusConflict, "conflict", "a replaced run cannot be submitted"},
		{"closed", http.StatusConflict, "conflict", "a recorded run cannot be replaced by a different one"},
		{"wrong_rules", http.StatusConflict, "conflict", "a run pinned to other rules cannot be verified"},
		{"invalid_actions", http.StatusUnprocessableEntity, "unprocessable_entity", "an impossible run is not a score"},
		{"invalid_duration", http.StatusUnprocessableEntity, "unprocessable_entity", "a duration longer than the session is impossible"},
		{"score_mismatch", http.StatusUnprocessableEntity, "unprocessable_entity", "a claim the replay contradicts is refused"},
		{"out_of_time", http.StatusUnprocessableEntity, "unprocessable_entity", "a Zip run that outlasted its clock is refused"},
		{"already_played", http.StatusConflict, "conflict", "a second run of today's deck cannot become a second score"},
	}
	for _, tc := range cases {
		t.Run(tc.outcome, func(t *testing.T) {
			backend := testBackend()
			backend.result = supabaseplay.Result{Outcome: tc.outcome, SessionID: sessionID}
			server := testServer(t, backend)

			status, body := post(t, server,
				"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), "")

			if status != tc.status {
				t.Fatalf("status = %d, want %d (%s)", status, tc.status, tc.why)
			}
			if errorCode(t, body) != tc.code {
				t.Fatalf("code = %s, want %s", errorCode(t, body), tc.code)
			}
		})
	}
}

func TestCompleteSessionRefusesAnOutcomeItDoesNotKnow(t *testing.T) {
	backend := testBackend()
	backend.result = supabaseplay.Result{Outcome: "something-new"}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), "")

	// An unrecognised verdict means the run's state is unknown. Reporting it as
	// success would be the one unrecoverable mistake.
	if status != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", status)
	}
	if errorCode(t, body) != "internal_error" {
		t.Fatalf("code = %s, want internal_error", errorCode(t, body))
	}
}

func TestCompleteSessionRejectsAMalformedRequest(t *testing.T) {
	cases := map[string]struct{ path, body string }{
		"a session id that is not an id": {"/api/v1/sessions/not-a-session/complete", completeBody("55", "45000", greedyRun)},
		"a negative score":               {"/api/v1/sessions/" + sessionID + "/complete", completeBody("-1", "45000", greedyRun)},
		"no duration":                    {"/api/v1/sessions/" + sessionID + "/complete", completeBody("55", "0", greedyRun)},
		"no progress at all":             {"/api/v1/sessions/" + sessionID + "/complete", `{"score":55,"durationMs":45000}`},
		"more moves than a submission can carry": {"/api/v1/sessions/" + sessionID + "/complete",
			completeBody("55", "45000", "["+strings.Repeat("0,", 4096)+"0]")},
		"a column that does not exist": {"/api/v1/sessions/" + sessionID + "/complete", completeBody("55", "45000", "[0,4]")},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			backend := testBackend()
			server := testServer(t, backend)

			status, body := post(t, server, tc.path, tc.body, "")

			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%#v)", status, body)
			}
			if errorCode(t, body) != "bad_request" {
				t.Fatalf("code = %s, want bad_request", errorCode(t, body))
			}
			if backend.runCalls != 0 {
				t.Fatal("a malformed submission reached the verifier")
			}
		})
	}
}

func TestCompleteSessionVerifiesAChainRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:        "recorded",
		SessionID:      sessionID,
		GameSlug:       "dont-break-the-chain",
		Score:          ptr(int64(3)),
		ClearedColumns: ptr(2),
		TilesPlaced:    ptr(4),
		DurationMS:     ptr(12000),
		Ranked:         ptr(true),
		RecordedAt:     &started,
		PersonalBest:   ptr(int64(3)),
		Rank:           ptr(int64(1)),
	}
	server := testServer(t, backend)

	// Rounds one and two reproduced, then the tap that broke the chain: three
	// correct taps, two cleared rounds, four taps placed.
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		`{"score":3,"durationMs":12000,"progress":{"rulesVersion":"chain@1","actions":[0,0,0,1]}}`, "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(3) || body["gameSlug"] != "dont-break-the-chain" {
		t.Fatalf("body = %#v, want the verified Chain run", body)
	}
	// The pinned version travels through untouched: it is what selects the
	// verifier behind the handler.
	if backend.lastRun.RulesVersion != "chain@1" {
		t.Fatalf("rules version = %q, want the run's pinned chain@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 4 {
		t.Fatalf("actions = %v, want the submitted taps", backend.lastRun.Actions)
	}
}

// TestCompleteSessionForwardsARunPastTheOldMoveCeiling is the regression guard
// for endless Chain: a run of more than sixty moves used to be refused by the
// transport before the verifier saw it, which would have made every run past the
// former tenth round unsubmittable. The handler does not replay (the database
// does), so this pins only that the body reaches it intact.
func TestCompleteSessionForwardsARunPastTheOldMoveCeiling(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	// Sixty-six correct taps plus one losing tap: eleven rounds cleared, exactly
	// the shape of a run that has passed the old tenth-round endpoint.
	actions := make([]string, 67)
	for i := range actions {
		actions[i] = "0"
	}

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules("chain@2", "66", "12000", "["+strings.Join(actions, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 67 {
		t.Fatalf("actions = %d, want all 67 forwarded", len(backend.lastRun.Actions))
	}
	if backend.lastRun.RulesVersion != "chain@2" {
		t.Fatalf("rules version = %q, want chain@2", backend.lastRun.RulesVersion)
	}
}

// TestCompleteSessionAcceptsAStack10RunPastTheRetiredDeck is the endless Stack
// 10 guard: the retired deck's sixty tiles used to be the transport's ceiling, so
// a run that kept playing would have been refused before the verifier saw it.
func TestCompleteSessionAcceptsAStack10RunPastTheRetiredDeck(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	// Two hundred columns is far past the sixty-tile deck and is ordinary play on
	// the endless board.
	actions := make([]string, 0, 200)
	for index := 0; index < 200; index += 1 {
		actions = append(actions, fmt.Sprint(index%4))
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(stack10EndlessRules, "120", "12000",
			"["+strings.Join(actions, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 200 {
		t.Fatalf("actions = %d, want the 200 submitted tiles", len(backend.lastRun.Actions))
	}
	if backend.lastRun.RulesVersion != stack10EndlessRules {
		t.Fatalf("rules version = %q, want stack-10@2", backend.lastRun.RulesVersion)
	}
}

func TestCompleteSessionRejectsAStack10RunPastTheLegacyDeck(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	// A legacy stack-10@1 run keeps the ordinary sixty-move request bound: the
	// endless ceiling is raised by the rules version, not for everyone.
	actions := make([]string, 0, 61)
	for index := 0; index < 61; index += 1 {
		actions = append(actions, fmt.Sprint(index%4))
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(rulesVersion, "0", "45000",
			"["+strings.Join(actions, ",")+"]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	if backend.runCalls != 0 {
		t.Fatal("a run past the legacy deck reached the verifier")
	}
}

func TestCompleteSessionVerifiesAMemoryFlashRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:        "recorded",
		SessionID:      sessionID,
		GameSlug:       "memory-flash",
		Score:          ptr(int64(10)),
		ClearedColumns: ptr(1),
		TilesPlaced:    ptr(3),
		DurationMS:     ptr(12000),
		Ranked:         ptr(true),
		RecordedAt:     &started,
		PersonalBest:   ptr(int64(10)),
		Rank:           ptr(int64(1)),
	}
	server := testServer(t, backend)

	// Round one rebuilt, the first cell of round two entered, then a losing tap:
	// ten points, one cleared pattern, three taps placed.
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(memoryFlashRules, "10", "12000", memoryFlashRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(10) || body["gameSlug"] != "memory-flash" {
		t.Fatalf("body = %#v, want the verified Memory Flash run", body)
	}
	// The pinned version travels through untouched: it is what selects the
	// verifier behind the handler.
	if backend.lastRun.RulesVersion != memoryFlashRules {
		t.Fatalf("rules version = %q, want the run's pinned memory-flash@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 3 || backend.lastRun.Actions[2] != 0 {
		t.Fatalf("actions = %v, want the submitted taps", backend.lastRun.Actions)
	}
}

func TestCompleteSessionAcceptsAMemoryFlashCellBeyondFour(t *testing.T) {
	// Memory Flash addresses sixteen cells. The bound is selected by the pinned
	// rules version, so a cell index the Stack 10 board would reject must reach
	// the Memory Flash verifier.
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(memoryFlashRules, "0", "45000", "[15]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 1 || backend.lastRun.Actions[0] != 15 {
		t.Fatalf("actions = %v, want the sixteenth cell", backend.lastRun.Actions)
	}
}

func TestCompleteSessionRejectsAMemoryFlashCellPastTheBoard(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(memoryFlashRules, "0", "45000", "[16]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	// A sixteenth cell is malformed input, so it must never start a replay.
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the board reached the verifier")
	}
}

func TestCompleteSessionAcceptsAMemoryFlashEndlessRun(t *testing.T) {
	// The endless rules address a growing board and carry up to 4096 taps, so a
	// run past the retired ninety-sixth cell and past the ordinary sixty-move
	// request bound must reach the Memory Flash verifier untouched. Whether the
	// sequence is possible is the verifier's call, not the transport's.
	backend := testBackend()
	server := testServer(t, backend)

	taps := make([]string, 61)
	for i := range taps {
		taps[i] = "24"
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(memoryFlashEndlessRules, "120", "45000", "["+strings.Join(taps, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if backend.lastRun.RulesVersion != memoryFlashEndlessRules {
		t.Fatalf("rules version = %q, want the run's pinned memory-flash@2", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 61 || backend.lastRun.Actions[60] != 24 {
		t.Fatalf("actions = %v, want sixty-one taps on the grown board", backend.lastRun.Actions)
	}
}

func TestCompleteSessionRejectsAMemoryFlashCellPastTheGrownBoard(t *testing.T) {
	// The endless board is bounded by the submission bound (a 15×15 board at the
	// furthest reachable round); a cell past it is malformed input, not a bad run.
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(memoryFlashEndlessRules, "0", "45000", "[225]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the endless board reached the verifier")
	}
}

func TestCompleteSessionVerifiesAOneMoveRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:        "recorded",
		SessionID:      sessionID,
		GameSlug:       "one-move",
		Score:          ptr(int64(10)),
		ClearedColumns: ptr(1),
		TilesPlaced:    ptr(2),
		DurationMS:     ptr(12000),
		Ranked:         ptr(true),
		RecordedAt:     &started,
		PersonalBest:   ptr(int64(10)),
		Rank:           ptr(int64(1)),
	}
	server := testServer(t, backend)

	// Board one restored, then a losing tap on board two: ten points, one
	// restored board, two taps placed.
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(oneMoveRules, "10", "12000", oneMoveRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(10) || body["gameSlug"] != "one-move" {
		t.Fatalf("body = %#v, want the verified One Move run", body)
	}
	// The pinned version travels through untouched: it is what selects the
	// verifier behind the handler.
	if backend.lastRun.RulesVersion != oneMoveRules {
		t.Fatalf("rules version = %q, want the run's pinned one-move@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 2 || backend.lastRun.Actions[0] != 7 {
		t.Fatalf("actions = %v, want the submitted taps", backend.lastRun.Actions)
	}
}

func TestCompleteSessionAcceptsAOneMoveEndlessRun(t *testing.T) {
	// The endless rules address a growing board and carry up to 4096 taps, so a
	// run past the retired twenty-fifth cell and past the ordinary sixty-move
	// request bound must reach the One Move verifier untouched. Whether the
	// sequence is possible is the verifier's call, not the transport's.
	backend := testBackend()
	server := testServer(t, backend)

	taps := make([]string, 61)
	for i := range taps {
		taps[i] = "35"
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(oneMoveEndlessRules, "0", "45000", "["+strings.Join(taps, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if backend.lastRun.RulesVersion != oneMoveEndlessRules {
		t.Fatalf("rules version = %q, want the run's pinned one-move@2", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 61 || backend.lastRun.Actions[60] != 35 {
		t.Fatalf("actions = %v, want sixty-one taps on the grown board", backend.lastRun.Actions)
	}
}

func TestCompleteSessionRejectsAOneMoveCellPastTheGrownBoard(t *testing.T) {
	// The endless board is bounded by the submission bound (a 1026×1026 board at
	// the furthest reachable level); a cell past it is malformed input, not a bad
	// run.
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(oneMoveEndlessRules, "0", "45000", "[1052676]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the endless board reached the verifier")
	}
}

func TestCompleteSessionAcceptsAOneMoveCellBeyondMemoryFlash(t *testing.T) {
	// One Move's largest board is 5×5. A cell the Memory Flash board would
	// reject must reach the One Move verifier.
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(oneMoveRules, "0", "45000", "[24]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 1 || backend.lastRun.Actions[0] != 24 {
		t.Fatalf("actions = %v, want the twenty-fifth cell", backend.lastRun.Actions)
	}
}

func TestCompleteSessionVerifiesAQueensRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:        "recorded",
		SessionID:      sessionID,
		GameSlug:       "queens",
		Score:          ptr(int64(50)),
		ClearedColumns: ptr(1),
		TilesPlaced:    ptr(10),
		DurationMS:     ptr(30000),
		Ranked:         ptr(true),
		RecordedAt:     &started,
		PersonalBest:   ptr(int64(50)),
		Rank:           ptr(int64(1)),
	}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(queensRules, "50", "30000", queensRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(50) || body["gameSlug"] != "queens" {
		t.Fatalf("body = %#v, want the verified Queens run", body)
	}
	if backend.lastRun.RulesVersion != queensRules {
		t.Fatalf("rules version = %q, want the run's pinned queens@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 10 || backend.lastRun.Actions[9] != 22 {
		t.Fatalf("actions = %v, want the submitted taps", backend.lastRun.Actions)
	}
}

func TestCompleteSessionAcceptsALongQueensRunOnTheLargestBoard(t *testing.T) {
	// Notes are taps, so a Queens run may carry up to 8192 of them — past the
	// other endless games' 4096 — and address any cell of the 9×9 board.
	backend := testBackend()
	server := testServer(t, backend)

	taps := make([]string, 8192)
	for i := range taps {
		taps[i] = "80"
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(queensRules, "0", "45000", "["+strings.Join(taps, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 8192 || backend.lastRun.Actions[8191] != 80 {
		t.Fatalf("actions = %d taps, want all 8192 on the 9×9 board", len(backend.lastRun.Actions))
	}
}

func TestCompleteSessionRejectsAQueensRunPastItsBounds(t *testing.T) {
	cases := map[string]string{
		// The eighty-second cell is past the 9×9 board.
		"a cell past the largest board": "[81]",
		"more taps than a submission carries": "[" + strings.TrimSuffix(
			strings.Repeat("0,", 8193), ",") + "]",
	}
	for name, actions := range cases {
		t.Run(name, func(t *testing.T) {
			backend := testBackend()
			server := testServer(t, backend)

			status, body := post(t, server,
				"/api/v1/sessions/"+sessionID+"/complete",
				completeBodyRules(queensRules, "0", "45000", actions), "")

			if status != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400 (%#v)", status, body)
			}
			if backend.runCalls != 0 {
				t.Fatal("a malformed Queens run reached the verifier")
			}
		})
	}
}

func TestCompleteSessionVerifiesAZipRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 11, 5, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:        "recorded",
		SessionID:      sessionID,
		GameSlug:       "zip",
		Score:          ptr(int64(50)),
		ClearedColumns: ptr(1),
		TilesPlaced:    ptr(25),
		DurationMS:     ptr(20000),
		Ranked:         ptr(true),
		RecordedAt:     &started,
	}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(zipRules, "50", "20000", zipRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(50) || body["gameSlug"] != "zip" {
		t.Fatalf("body = %#v, want the verified Zip run", body)
	}
	if backend.lastRun.RulesVersion != zipRules {
		t.Fatalf("rules version = %q, want the run's pinned zip@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 25 || backend.lastRun.Actions[24] != 0 {
		t.Fatalf("actions = %v, want the drawn path", backend.lastRun.Actions)
	}
}

func TestCompleteSessionRejectsAZipCellPastTheLargestBoard(t *testing.T) {
	// The largest Zip board is 7×7, so cell 49 is malformed input.
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(zipRules, "0", "20000", "[48,49]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the Zip board reached the verifier")
	}
}

func TestCompleteSessionRejectsAOneMoveCellPastTheBoard(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(oneMoveRules, "0", "45000", "[25]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	// A twenty-sixth cell is malformed input, so it must never start a replay.
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the board reached the verifier")
	}
}

func TestCompleteSessionVerifiesAColorMergeRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:      "recorded",
		SessionID:    sessionID,
		GameSlug:     "color-merge",
		Score:        ptr(int64(4)),
		TilesPlaced:  ptr(2),
		DurationMS:   ptr(12000),
		Ranked:       ptr(true),
		RecordedAt:   &started,
		PersonalBest: ptr(int64(4)),
		Rank:         ptr(int64(1)),
	}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(colorMergeRules, "4", "12000", colorMergeRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(4) || body["gameSlug"] != "color-merge" {
		t.Fatalf("body = %#v, want the verified Color Merge run", body)
	}
	// The pinned version travels through untouched: it is what selects the
	// verifier behind the handler.
	if backend.lastRun.RulesVersion != colorMergeRules {
		t.Fatalf("rules version = %q, want the run's pinned color-merge@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 2 || backend.lastRun.Actions[0] != 3 {
		t.Fatalf("actions = %v, want the submitted directions", backend.lastRun.Actions)
	}
}

func TestCompleteSessionRejectsAColorMergeDirectionPastTheBoard(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(colorMergeRules, "0", "45000", "[4]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	// A fifth direction is malformed input, so it must never start a replay.
	if backend.runCalls != 0 {
		t.Fatal("a direction outside the board reached the verifier")
	}
}

func TestCompleteSessionAcceptsAColorMergeRunPastTheLegacyDeck(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:      "recorded",
		SessionID:    sessionID,
		GameSlug:     "color-merge",
		Score:        ptr(int64(120)),
		TilesPlaced:  ptr(49),
		DurationMS:   ptr(21000),
		Ranked:       ptr(true),
		RecordedAt:   &started,
		PersonalBest: ptr(int64(120)),
		Rank:         ptr(int64(1)),
	}
	server := testServer(t, backend)

	// Two hundred valid directions are far past the legacy forty-eight-slide
	// deck and are ordinary play on the endless board.
	actions := make([]string, 0, 200)
	for index := 0; index < 200; index++ {
		actions = append(actions, fmt.Sprint(index%4))
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(colorMergeEndlessRules, "120", "21000",
			"["+strings.Join(actions, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 200 {
		t.Fatalf("actions = %d, want the 200 submitted slides", len(backend.lastRun.Actions))
	}
	if backend.lastRun.RulesVersion != colorMergeEndlessRules {
		t.Fatalf("rules version = %q, want color-merge@2", backend.lastRun.RulesVersion)
	}
}

func TestCompleteSessionRejectsAColorMergeRunPastTheLegacyDeck(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	// A legacy color-merge@1 run keeps the ordinary sixty-move request bound:
	// the endless ceiling is raised by the rules version, not for everyone.
	actions := make([]string, 0, 61)
	for index := 0; index < 61; index++ {
		actions = append(actions, fmt.Sprint(index%4))
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(colorMergeRules, "0", "45000",
			"["+strings.Join(actions, ",")+"]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	if backend.runCalls != 0 {
		t.Fatal("a run past the legacy deck reached the verifier")
	}
}

func TestCompleteSessionVerifiesADontTouchRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 23, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:      "recorded",
		SessionID:    sessionID,
		GameSlug:     "dont-touch-the-black",
		Score:        ptr(int64(10)),
		TilesPlaced:  ptr(2),
		DurationMS:   ptr(21000),
		Ranked:       ptr(true),
		RecordedAt:   &started,
		PersonalBest: ptr(int64(10)),
		Rank:         ptr(int64(1)),
	}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(dontTouchRules, "10", "21000", dontTouchRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(10) || body["gameSlug"] != "dont-touch-the-black" {
		t.Fatalf("body = %#v, want the verified Don't Touch the Black run", body)
	}
	// The pinned version travels through untouched: it is what selects the
	// verifier behind the handler.
	if backend.lastRun.RulesVersion != dontTouchRules {
		t.Fatalf("rules version = %q, want the run's pinned dont-touch@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 2 || backend.lastRun.Actions[1] != 0 {
		t.Fatalf("actions = %v, want the submitted taps", backend.lastRun.Actions)
	}
}

func TestCompleteSessionAcceptsADontTouchRunPastTheLegacyDeck(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 27, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:      "recorded",
		SessionID:    sessionID,
		GameSlug:     "dont-touch-the-black",
		Score:        ptr(int64(2060)),
		TilesPlaced:  ptr(206),
		DurationMS:   ptr(21000),
		Ranked:       ptr(true),
		RecordedAt:   &started,
		PersonalBest: ptr(int64(2060)),
		Rank:         ptr(int64(1)),
	}
	server := testServer(t, backend)

	// Cell 60 is past the legacy sixty-cell deck, and 61 taps are past the legacy
	// action bound: both are ordinary play on the endless conveyor.
	actions := make([]string, 0, 61)
	for cell := 60; cell < 121; cell++ {
		actions = append(actions, fmt.Sprint(cell))
	}
	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(dontTouchEndlessRules, "2060", "21000",
			"["+strings.Join(actions, ",")+"]"), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if len(backend.lastRun.Actions) != 61 || backend.lastRun.Actions[0] != 60 {
		t.Fatalf("actions = %v, want the submitted taps", backend.lastRun.Actions)
	}
	if backend.lastRun.RulesVersion != dontTouchEndlessRules {
		t.Fatalf("rules version = %q, want dont-touch@2", backend.lastRun.RulesVersion)
	}
}

func TestCompleteSessionRejectsADontTouchCellPastTheEndlessConveyor(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(dontTouchEndlessRules, "0", "45000", "[4095]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the conveyor reached the verifier")
	}
}

func TestCompleteSessionRejectsADontTouchCellPastTheDeck(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(dontTouchRules, "0", "45000", "[60]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	// A sixty-first cell is malformed input, so it must never start a replay.
	if backend.runCalls != 0 {
		t.Fatal("a cell outside the deck reached the verifier")
	}
}

func TestStartSessionReportsTodaysAttemptAsDone(t *testing.T) {
	backend := testBackend()
	// The database answers `already_played` when a signed-in player has already
	// finished today's deck. It is a rule, not a failure, and the client shows it
	// as one — so it must be a 409 and not a generic 503.
	backend.start = supabaseplay.Start{Outcome: "already_played"}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions", startBody("7-second", sevenSecondRules), token(t, testUserID))

	if status != http.StatusConflict {
		t.Fatalf("status = %d, want 409 (%#v)", status, body)
	}
	if errorCode(t, body) != "conflict" {
		t.Fatalf("code = %s, want conflict", errorCode(t, body))
	}
	failure := body["error"].(map[string]any)
	if message, _ := failure["message"].(string); !strings.Contains(message, "midnight UTC") {
		t.Fatalf("message = %q, want the next deck's time", message)
	}
}

func TestCompleteSessionVerifiesASevenSecondRun(t *testing.T) {
	backend := testBackend()
	started := time.Date(2026, 10, 24, 12, 0, 0, 0, time.UTC)
	backend.result = supabaseplay.Result{
		Outcome:      "recorded",
		SessionID:    sessionID,
		GameSlug:     "7-second",
		Score:        ptr(int64(30)),
		TilesPlaced:  ptr(4),
		DurationMS:   ptr(9000),
		Ranked:       ptr(true),
		RecordedAt:   &started,
		PersonalBest: ptr(int64(30)),
		Rank:         ptr(int64(1)),
	}
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(sevenSecondRules, "30", "9000", sevenSecondRun), "")

	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%#v)", status, body)
	}
	if body["score"] != float64(30) || body["gameSlug"] != "7-second" {
		t.Fatalf("body = %#v, want the verified 7 Second run", body)
	}
	if backend.lastRun.RulesVersion != sevenSecondRules {
		t.Fatalf("rules version = %q, want the run's pinned seven-second@1", backend.lastRun.RulesVersion)
	}
	if len(backend.lastRun.Actions) != 4 || backend.lastRun.Actions[2] != 2 {
		t.Fatalf("actions = %v, want the submitted answers", backend.lastRun.Actions)
	}
}

func TestCompleteSessionRejectsASevenSecondChoicePastTheButtons(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete",
		completeBodyRules(sevenSecondRules, "0", "45000", "[3]"), "")

	if status != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 (%#v)", status, body)
	}
	if errorCode(t, body) != "bad_request" {
		t.Fatalf("code = %s, want bad_request", errorCode(t, body))
	}
	// A fourth button does not exist, so it is malformed input and must never
	// start a replay.
	if backend.runCalls != 0 {
		t.Fatal("a choice outside the buttons reached the verifier")
	}
}

func TestCompleteSessionAnswersServiceUnavailableWithoutAClient(t *testing.T) {
	server := testServer(t, nil)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), "")

	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	if errorCode(t, body) != "service_unavailable" {
		t.Fatalf("code = %s, want service_unavailable", errorCode(t, body))
	}
}

func TestCompleteSessionAnswersServiceUnavailableWhenTheDatabaseFails(t *testing.T) {
	backend := testBackend()
	backend.runErr = errors.New("connection refused")
	server := testServer(t, backend)

	status, body := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), "")

	if status != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", status)
	}
	if body["message"] == "connection refused" {
		t.Fatal("the transport error leaked into the response")
	}
}

// TestSessionResponseCarriesNoFabricatedNumbers is the guard this whole phase
// turns on: a session response may carry the seed, the tile count and the
// numbers the database derived, and nothing that looks like a measurement
// nobody made.
func TestSessionResponseCarriesNoFabricatedNumbers(t *testing.T) {
	backend := testBackend()
	server := testServer(t, backend)

	_, started := post(t, server, "/api/v1/sessions", startBody("stack-10", rulesVersion), "")
	_, finished := post(t, server,
		"/api/v1/sessions/"+sessionID+"/complete", completeBody("55", "45000", greedyRun), "")

	wantStart := map[string]bool{
		"id": true, "gameSlug": true, "rulesVersion": true, "seed": true,
		"tileCount": true, "startedAt": true, "expiresAt": true, "ranked": true,
	}
	for field := range started {
		if !wantStart[field] {
			t.Errorf("a session carries an undeclared field %q", field)
		}
	}

	wantResult := map[string]bool{
		"sessionId": true, "gameSlug": true, "score": true, "clearedColumns": true,
		"tilesPlaced": true, "durationMs": true, "ranked": true, "recordedAt": true,
		"personalBest": true, "rank": true, "duplicate": true,
	}
	for field := range finished {
		if !wantResult[field] {
			t.Errorf("a run result carries an undeclared field %q", field)
		}
	}
}
