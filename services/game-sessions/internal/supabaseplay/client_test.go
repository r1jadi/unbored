package supabaseplay

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/config"
)

// recorder is a stand-in Data API: it answers one canned body and remembers the
// request, which is how a test asserts exactly what was sent.
type recorder struct {
	status int
	body   string
	server *httptest.Server

	path   string
	method string
	header http.Header
	raw    string
}

func newRecorder(t *testing.T, status int, body string) *recorder {
	t.Helper()
	rec := &recorder{status: status, body: body}
	rec.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		rec.path = r.URL.Path
		rec.method = r.Method
		rec.header = r.Header.Clone()
		rec.raw = string(raw)

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(rec.status)
		_, _ = io.WriteString(w, rec.body)
	}))
	t.Cleanup(rec.server.Close)
	return rec
}

func (r *recorder) client(t *testing.T) *Client {
	t.Helper()
	cfg := &config.Config{}
	cfg.Supabase.ProjectURL = r.server.URL
	cfg.Supabase.PublishableKey = "sb_publishable_test_value"
	client, err := New(cfg)
	if err != nil {
		t.Fatalf("building client: %v", err)
	}
	return client
}

func (r *recorder) payload(t *testing.T) map[string]any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal([]byte(r.raw), &decoded); err != nil {
		t.Fatalf("decoding request body %q: %v", r.raw, err)
	}
	return decoded
}

const startRow = `{"outcome":"started","id":"cccccccc-1111-4111-8111-cccccccccccc",` +
	`"game_slug":"stack-10","rules_version":"stack-10@1","seed":9223372036854775807,` +
	`"tile_count":60,"started_at":"2026-10-13T12:00:00+00:00","expires_at":"2026-10-13T14:00:00+00:00",` +
	`"ranked":false}`

func TestStartSessionPostsToTheFunction(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, startRow)

	start, err := rec.client(t).StartSession(context.Background(), StartRequest{
		GameSlug:     "stack-10",
		RulesVersion: "stack-10@1",
		Client:       "web/1.0",
	})
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	if rec.method != http.MethodPost || rec.path != "/rest/v1/rpc/start_game_session" {
		t.Fatalf("%s %s, want POST /rest/v1/rpc/start_game_session", rec.method, rec.path)
	}
	if got := rec.header.Get("apikey"); got != "sb_publishable_test_value" {
		t.Fatalf("apikey = %q, want the publishable key", got)
	}
	// Anonymous play is the absence of a token, not a placeholder for one.
	if got := rec.header.Get("Authorization"); got != "" {
		t.Fatalf("Authorization = %q, want none for an anonymous run", got)
	}
	payload := rec.payload(t)
	if payload["p_game_slug"] != "stack-10" || payload["p_rules_version"] != "stack-10@1" || payload["p_client"] != "web/1.0" {
		t.Fatalf("payload = %#v", payload)
	}

	// The seed is a 63-bit value: it has to arrive as the exact digits, because
	// a rounded one would silently change every tile of the run.
	if start.Seed != "9223372036854775807" {
		t.Fatalf("seed = %q, want the exact decimal digits", start.Seed)
	}
	if start.TileCount != 60 || start.Ranked {
		t.Fatalf("start = %+v, want 60 tiles and an unranked run", start)
	}
	if !start.StartedAt.Equal(time.Date(2026, 10, 13, 12, 0, 0, 0, time.UTC)) {
		t.Fatalf("startedAt = %s", start.StartedAt)
	}
}

func TestStartSessionCarriesTheCallersToken(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, startRow)

	if _, err := rec.client(t).StartSession(context.Background(), StartRequest{
		GameSlug:     "stack-10",
		RulesVersion: "stack-10@1",
		AccessToken:  "caller-token-1",
	}); err != nil {
		t.Fatalf("StartSession: %v", err)
	}

	if got := rec.header.Get("Authorization"); got != "Bearer caller-token-1" {
		t.Fatalf("Authorization = %q, want the caller's token", got)
	}
}

func TestStartSessionPassesRefusalsThrough(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, `{"outcome":"not_playable"}`)

	start, err := rec.client(t).StartSession(context.Background(), StartRequest{
		GameSlug:     "color-merge",
		RulesVersion: "stack-10@1",
	})
	if err != nil {
		t.Fatalf("StartSession: %v", err)
	}
	if start.Outcome != "not_playable" || start.ID != "" {
		t.Fatalf("start = %+v, want a refusal with no session", start)
	}
}

func TestStartSessionRefusesAnIncompleteSession(t *testing.T) {
	// A null where the seed should be, which is what a schema change looks like
	// from here: better a loud failure than a run with no deck.
	rec := newRecorder(t, http.StatusOK, `{"outcome":"started","id":"x","game_slug":"stack-10"}`)

	if _, err := rec.client(t).StartSession(context.Background(), StartRequest{
		GameSlug:     "stack-10",
		RulesVersion: "stack-10@1",
	}); err == nil {
		t.Fatal("an incomplete session must not be returned as a started run")
	}
}

const resultRow = `{"outcome":"recorded","session_id":"cccccccc-1111-4111-8111-cccccccccccc",` +
	`"game_slug":"stack-10","score":55,"cleared_columns":3,"tiles_placed":14,"duration_ms":45000,` +
	`"ranked":true,"recorded_at":"2026-10-13T12:05:00+00:00","personal_best":55,"board_rank":1}`

func TestCompleteRunPostsTheRun(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	result, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:   "cccccccc-1111-4111-8111-cccccccccccc",
		Actions:     []int32{0, 0, 1, 0},
		Score:       55,
		DurationMS:  45000,
		AccessToken: "caller-token-1",
	})
	if err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	if rec.path != "/rest/v1/rpc/complete_stack10_run" {
		t.Fatalf("path = %s, want the verifier function", rec.path)
	}
	payload := rec.payload(t)
	// The claim travels with the run so the verifier can contradict it; the
	// service never treats it as the score.
	if payload["p_score"] != float64(55) {
		t.Fatalf("p_score = %v, want the client's claim", payload["p_score"])
	}
	actions, ok := payload["p_actions"].([]any)
	if !ok || len(actions) != 4 {
		t.Fatalf("p_actions = %#v, want the submitted run", payload["p_actions"])
	}
	if result.Score == nil || *result.Score != 55 || result.TilesPlaced == nil || *result.TilesPlaced != 14 {
		t.Fatalf("result = %+v, want the derived numbers", result)
	}
	if result.Rank == nil || *result.Rank != 1 || result.PersonalBest == nil || *result.PersonalBest != 55 {
		t.Fatalf("result = %+v, want the real rank and best", result)
	}
	if result.RecordedAt == nil {
		t.Fatal("result carries no recorded time")
	}
}

func TestCompleteRunRoutesChainRulesToChainVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "chain@1",
		Actions:      []int32{0, 0, 0},
		Score:        3,
		DurationMS:   12000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a Chain run is verified by
	// complete_chain_run, not by Stack 10's function.
	if rec.path != "/rest/v1/rpc/complete_chain_run" {
		t.Fatalf("path = %s, want the Chain verifier function", rec.path)
	}
}

func TestCompleteRunRoutesMemoryFlashRulesToMemoryFlashVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "memory-flash@1",
		Actions:      []int32{8, 8, 0},
		Score:        10,
		DurationMS:   12000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a Memory Flash run is verified by
	// complete_memory_flash_run, not by either of the other two.
	if rec.path != "/rest/v1/rpc/complete_memory_flash_run" {
		t.Fatalf("path = %s, want the Memory Flash verifier function", rec.path)
	}
}

func TestCompleteRunRoutesOneMoveRulesToOneMoveVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "one-move@1",
		Actions:      []int32{7, 0},
		Score:        10,
		DurationMS:   12000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a One Move run is verified by
	// complete_one_move_run, not by any of the other three.
	if rec.path != "/rest/v1/rpc/complete_one_move_run" {
		t.Fatalf("path = %s, want the One Move verifier function", rec.path)
	}
}

func TestCompleteRunRoutesQueensRulesToQueensVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "queens@1",
		Actions:      []int32{1, 1, 8, 8, 10, 10, 19, 19, 22, 22},
		Score:        50,
		DurationMS:   30000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a Queens run is verified by
	// complete_queens_run.
	if rec.path != "/rest/v1/rpc/complete_queens_run" {
		t.Fatalf("path = %s, want the Queens verifier function", rec.path)
	}
}

func TestCompleteRunRoutesZipRulesToZipVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "zip@1",
		Actions:      []int32{8, 7, 6},
		Score:        0,
		DurationMS:   20000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	if rec.path != "/rest/v1/rpc/complete_zip_run" {
		t.Fatalf("path = %s, want the Zip verifier function", rec.path)
	}
}

func TestCompleteRunRoutesSudokuRulesToSudokuVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "dddddddd-1111-4111-8111-dddddddddddd",
		RulesVersion: "sudoku@1",
		Actions:      []int32{6, 13},
		Score:        0,
		DurationMS:   20000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	if rec.path != "/rest/v1/rpc/complete_sudoku_run" {
		t.Fatalf("path = %s, want the Sudoku verifier function", rec.path)
	}
}

func TestCompleteRunRoutesTangoRulesToTangoVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "tango@1",
		Actions:      []int32{1, 2},
		Score:        0,
		DurationMS:   20000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	if rec.path != "/rest/v1/rpc/complete_tango_run" {
		t.Fatalf("path = %s, want the Tango verifier function", rec.path)
	}
}

func TestCompleteRunRoutesEightPuzzleRulesToEightPuzzleVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "eight-puzzle@1",
		Actions:      []int32{5, 4},
		Score:        0,
		DurationMS:   20000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	if rec.path != "/rest/v1/rpc/complete_eight_puzzle_run" {
		t.Fatalf("path = %s, want the 8 Puzzle verifier function", rec.path)
	}
}

func TestCompleteRunRoutesColorMergeRulesToColorMergeVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "color-merge@1",
		Actions:      []int32{3, 2},
		Score:        4,
		DurationMS:   12000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a Color Merge run is verified by
	// complete_color_merge_run, not by any of the other four.
	if rec.path != "/rest/v1/rpc/complete_color_merge_run" {
		t.Fatalf("path = %s, want the Color Merge verifier function", rec.path)
	}
}

func TestCompleteRunRoutesDontTouchRulesToDontTouchVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "dont-touch@1",
		Actions:      []int32{2, 0},
		Score:        10,
		DurationMS:   21000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a Don't Touch the Black run is
	// verified by complete_dont_touch_run, not by any of the other five.
	if rec.path != "/rest/v1/rpc/complete_dont_touch_run" {
		t.Fatalf("path = %s, want the Don't Touch the Black verifier function", rec.path)
	}
}

func TestCompleteRunRoutesSevenSecondRulesToSevenSecondVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "seven-second@1",
		Actions:      []int32{0, 1, 2, 1},
		Score:        30,
		DurationMS:   9000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// The pinned version selects the replay: a 7 Second run is verified by
	// complete_seven_second_run, not by any of the other six.
	if rec.path != "/rest/v1/rpc/complete_seven_second_run" {
		t.Fatalf("path = %s, want the 7 Second verifier function", rec.path)
	}
}

func TestCompleteRunKeepsStack10RulesOnStackVerifier(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, resultRow)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID:    "cccccccc-1111-4111-8111-cccccccccccc",
		RulesVersion: "stack-10@1",
		Actions:      []int32{0, 0, 1, 0},
		Score:        55,
		DurationMS:   45000,
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	if rec.path != "/rest/v1/rpc/complete_stack10_run" {
		t.Fatalf("path = %s, want the Stack 10 verifier function", rec.path)
	}
}

func TestCompleteRunSendsAnEmptyArrayRatherThanNull(t *testing.T) {
	rec := newRecorder(t, http.StatusOK, `{"outcome":"invalid_actions"}`)

	if _, err := rec.client(t).CompleteRun(context.Background(), CompleteRequest{
		SessionID: "cccccccc-1111-4111-8111-cccccccccccc",
	}); err != nil {
		t.Fatalf("CompleteRun: %v", err)
	}

	// `null` would be a ragged submission, which the function refuses; an empty
	// array is a run that did not happen, which it scores as impossible.
	if actions := rec.payload(t)["p_actions"]; actions == nil {
		t.Fatal("p_actions was sent as null")
	}
}

func TestErrorsCarryACodeAndNoBody(t *testing.T) {
	rec := newRecorder(t, http.StatusBadRequest,
		`{"code":"22023","message":"invalid game slug","details":"the caller's own text"}`)

	_, err := rec.client(t).StartSession(context.Background(), StartRequest{
		GameSlug:     "stack-10",
		RulesVersion: "stack-10@1",
	})
	if err == nil {
		t.Fatal("a 400 must be an error")
	}
	apiErr, ok := err.(*Error)
	if !ok {
		t.Fatalf("error type = %T, want *Error", err)
	}
	if apiErr.Status != http.StatusBadRequest || apiErr.Code != "22023" {
		t.Fatalf("error = %+v, want the status and code", apiErr)
	}
	// 22023 is the only code the functions raise for input the service should
	// have rejected first, and it has to be recognisable as a caller mistake
	// rather than as an outage.
	if !apiErr.IsInvalidInput() {
		t.Fatalf("IsInvalidInput = false for %s", apiErr.Code)
	}
	// The response body can echo the caller's own input, so it must not travel
	// into a log line or an error message.
	if strings.Contains(apiErr.Error(), "the caller's own text") {
		t.Fatalf("the upstream body leaked into the error: %s", apiErr.Error())
	}
	if strings.Contains(apiErr.Error(), "invalid game slug") {
		t.Fatalf("the upstream message leaked into the error: %s", apiErr.Error())
	}
}
