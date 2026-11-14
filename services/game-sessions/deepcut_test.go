package gamesessions

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/game-sessions/internal/deepcutjudge"
)

const deepCutRun = "dddddddd-2222-4222-8222-dddddddddddd"

type deepCutCall struct {
	function string
	payload  map[string]any
	token    string
}

// fakeDeepCut is the play client with a Deep Cut surface: each function answers
// from a queue, and every call is recorded.
type fakeDeepCut struct {
	*fakeBackend
	answers map[string][]string
	calls   []deepCutCall
	err     error
}

func (f *fakeDeepCut) DeepCut(_ context.Context, function string, payload map[string]any, token string) (json.RawMessage, error) {
	f.calls = append(f.calls, deepCutCall{function, payload, token})
	if f.err != nil {
		return nil, f.err
	}
	queue := f.answers[function]
	if len(queue) == 0 {
		return json.RawMessage(`{"outcome":"not_found"}`), nil
	}
	next := queue[0]
	if len(queue) > 1 {
		f.answers[function] = queue[1:]
	}
	return json.RawMessage(next), nil
}

func (f *fakeDeepCut) called(function string) []deepCutCall {
	var out []deepCutCall
	for _, call := range f.calls {
		if call.function == function {
			out = append(out, call)
		}
	}
	return out
}

type fakeJudge struct {
	ruling deepcutjudge.Ruling
	err    error
	asked  []deepcutjudge.Question
}

func (j *fakeJudge) Rule(_ context.Context, question deepcutjudge.Question) (deepcutjudge.Ruling, error) {
	j.asked = append(j.asked, question)
	return j.ruling, j.err
}

func deepCutServer(t *testing.T, backend *fakeDeepCut, judging *deepCutJudging) *httptest.Server {
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
	service := newService(backend, logger)
	service.judging = judging
	service.register(router)
	server := httptest.NewServer(router.Mux())
	t.Cleanup(server.Close)
	return server
}

func TestDeepCutRevealPassesTheQuestionThrough(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_reveal": {`{"outcome":"shown","prompt":"Name a US state","position":0,"seconds":25}`},
	}}
	server := deepCutServer(t, backend, nil)

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0", `{}`, token(t, testUserID))
	if status != http.StatusOK || body["prompt"] != "Name a US state" {
		t.Fatalf("reveal = %d %v", status, body)
	}
	call := backend.called("deep_cut_reveal")[0]
	if call.payload["p_run_id"] != deepCutRun || call.payload["p_position"] != 0 || call.token == "" {
		t.Fatalf("reveal call = %+v", call)
	}
}

func TestDeepCutRevealValidatesThePath(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend()}
	server := deepCutServer(t, backend, nil)

	for _, path := range []string{
		"/api/v1/deep-cut/runs/not-a-uuid/questions/0",
		"/api/v1/deep-cut/runs/" + deepCutRun + "/questions/7",
		"/api/v1/deep-cut/runs/" + deepCutRun + "/questions/-1",
	} {
		if status, _ := post(t, server, path, `{}`, ""); status != http.StatusBadRequest {
			t.Errorf("POST %s = %d, want 400", path, status)
		}
	}
	if len(backend.calls) != 0 {
		t.Fatalf("a malformed path reached the database: %+v", backend.calls)
	}
}

func TestDeepCutRefusalsMapToHTTP(t *testing.T) {
	for outcome, want := range map[string]int{
		"not_found":        http.StatusNotFound,
		"expired":          http.StatusConflict,
		"closed":           http.StatusConflict,
		"out_of_order":     http.StatusConflict,
		"already_answered": http.StatusConflict,
		"something_new":    http.StatusInternalServerError,
	} {
		backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
			"deep_cut_reveal": {`{"outcome":"` + outcome + `"}`},
		}}
		server := deepCutServer(t, backend, nil)
		if status, _ := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/1", `{}`, ""); status != want {
			t.Errorf("outcome %s = %d, want %d", outcome, status, want)
		}
	}
}

func TestDeepCutAnswerWithoutAJudgeSettlesAtOnce(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_answer": {`{"outcome":"scored","turn":{"verdict":"correct","points":80}}`},
	}}
	server := deepCutServer(t, backend, nil)

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/2/answer",
		`{"answer":"  Delaware  "}`, "")
	if status != http.StatusOK || body["outcome"] != "scored" {
		t.Fatalf("answer = %d %v", status, body)
	}
	call := backend.called("deep_cut_answer")[0]
	if call.payload["p_answer"] != "Delaware" || call.payload["p_final"] != true {
		t.Fatalf("answer call = %+v", call.payload)
	}
}

func TestDeepCutAnswerRefusesALongAnswer(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend()}
	server := deepCutServer(t, backend, nil)
	long := `{"answer":"` + string(make([]byte, 0)) + "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijk" + `"}`
	if status, _ := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/answer", long, ""); status != http.StatusBadRequest {
		t.Fatalf("a 61-character answer = %d, want 400", status)
	}
}

func TestDeepCutUnknownAnswerIsJudgedRecordedAndSettled(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_answer": {
			`{"outcome":"unknown","position":0}`,
			`{"outcome":"scored","turn":{"verdict":"correct","points":60}}`,
		},
		"deep_cut_judge_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","category":"Food","answer":"Salak","key":"salak","known":["Apple","Snake fruit"]}`},
		"deep_cut_record_review": {`"accepted"`},
	}}
	judge := &fakeJudge{ruling: deepcutjudge.Ruling{Valid: true, Canonical: "Snake fruit", Tier: 5}}
	server := deepCutServer(t, backend, &deepCutJudging{judge: judge, key: "judge-key"})

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/answer", `{"answer":"Salak"}`, "")
	if status != http.StatusOK || body["outcome"] != "scored" {
		t.Fatalf("answer = %d %v", status, body)
	}
	answers := backend.called("deep_cut_answer")
	if len(answers) != 2 || answers[0].payload["p_final"] != false || answers[1].payload["p_final"] != true {
		t.Fatalf("answer calls = %+v", answers)
	}
	if len(judge.asked) != 1 || judge.asked[0].Answer != "Salak" || len(judge.asked[0].Known) != 2 {
		t.Fatalf("judge asked = %+v", judge.asked)
	}
	review := backend.called("deep_cut_record_review")
	if len(review) != 1 || review[0].payload["p_verdict"] != "accepted" ||
		review[0].payload["p_canonical"] != "Snake fruit" || review[0].payload["p_judge_key"] != "judge-key" ||
		review[0].token != "" {
		t.Fatalf("review call = %+v", review)
	}
}

func TestDeepCutJudgeFailureStillSettlesTheAnswer(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_answer": {
			`{"outcome":"unknown","position":0}`,
			`{"outcome":"scored","turn":{"verdict":"unverified","points":0}}`,
		},
		"deep_cut_judge_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","answer":"Zzz","key":"zzz","known":[]}`},
	}}
	judge := &fakeJudge{err: errors.New("network down")}
	server := deepCutServer(t, backend, &deepCutJudging{judge: judge, key: "judge-key"})

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/answer", `{"answer":"Zzz"}`, "")
	if status != http.StatusOK || body["outcome"] != "scored" {
		t.Fatalf("answer = %d %v", status, body)
	}
	if len(backend.called("deep_cut_record_review")) != 0 {
		t.Fatal("a failed ruling was recorded")
	}
}

func TestDeepCutRejectedRulingIsRecordedAsRejected(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_answer": {
			`{"outcome":"unknown","position":0}`,
			`{"outcome":"scored","turn":{"verdict":"wrong","points":0}}`,
		},
		"deep_cut_judge_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","answer":"Carrot","key":"carrot","known":[]}`},
		"deep_cut_record_review": {`"rejected"`},
	}}
	server := deepCutServer(t, backend, &deepCutJudging{judge: &fakeJudge{}, key: "k"})
	post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/answer", `{"answer":"Carrot"}`, "")
	review := backend.called("deep_cut_record_review")
	if len(review) != 1 || review[0].payload["p_verdict"] != "rejected" || review[0].payload["p_canonical"] != nil {
		t.Fatalf("review call = %+v", review)
	}
}

func TestDeepCutPracticeValidatesTheMode(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_start_practice": {`{"outcome":"started","runId":"` + deepCutRun + `"}`},
	}}
	server := deepCutServer(t, backend, nil)

	if status, _ := post(t, server, "/api/v1/deep-cut/practice", `{"mode":"ranked"}`, ""); status != http.StatusBadRequest {
		t.Fatalf("a bad mode = %d", status)
	}
	if status, _ := post(t, server, "/api/v1/deep-cut/practice", `{"mode":"archive"}`, ""); status != http.StatusBadRequest {
		t.Fatalf("an archive run without a day = %d", status)
	}
	status, body := post(t, server, "/api/v1/deep-cut/practice", `{"mode":"unlimited"}`, "")
	if status != http.StatusOK || body["runId"] != deepCutRun {
		t.Fatalf("unlimited = %d %v", status, body)
	}
	if call := backend.called("deep_cut_start_practice")[0]; call.payload["p_day"] != nil {
		t.Fatalf("unlimited sent a day: %+v", call.payload)
	}
}

func TestDeepCutArchiveListsDays(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_archive_days": {`[20768,20767]`},
	}}
	server := deepCutServer(t, backend, nil)
	response, err := http.Get(server.URL + "/api/v1/deep-cut/archive")
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var body struct {
		Days []int `json:"days"`
	}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || len(body.Days) != 2 || body.Days[0] != 20768 {
		t.Fatalf("archive = %d %+v", response.StatusCode, body)
	}
}

func TestDeepCutWithoutABackendAnswers503(t *testing.T) {
	server := deepCutServer(t, &fakeDeepCut{fakeBackend: testBackend(), err: errors.New("down")}, nil)
	if status, _ := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0", `{}`, ""); status != http.StatusServiceUnavailable {
		t.Fatalf("a failing database = %d, want 503", status)
	}
}

func TestDeepCutCheckPassesAKnownVerdictThrough(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_check": {`{"outcome":"checked","result":"invalid"}`},
	}}
	judge := &fakeJudge{}
	server := deepCutServer(t, backend, &deepCutJudging{judge: judge, key: "k"})

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/2/check", `{"answer":"  Carrot "}`, token(t, testUserID))
	if status != http.StatusOK || body["result"] != "invalid" {
		t.Fatalf("check = %d %v", status, body)
	}
	call := backend.called("deep_cut_check")[0]
	if call.payload["p_answer"] != "Carrot" || call.payload["p_position"] != 2 || call.token == "" {
		t.Fatalf("check call = %+v", call)
	}
	if len(judge.asked) != 0 || len(backend.called("deep_cut_answer")) != 0 {
		t.Fatal("a known verdict consulted the judge or submitted the answer")
	}
}

func TestDeepCutCheckAsksTheJudgeAboutAnUnknownAnswer(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_check": {
			`{"outcome":"checked","result":"unknown"}`,
			`{"outcome":"checked","result":"valid"}`,
		},
		"deep_cut_check_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","answer":"Salak","key":"salak","known":["Apple"]}`},
		"deep_cut_record_review": {`"accepted"`},
	}}
	judge := &fakeJudge{ruling: deepcutjudge.Ruling{Valid: true, Canonical: "Snake fruit", Tier: 5}}
	server := deepCutServer(t, backend, &deepCutJudging{judge: judge, key: "judge-key"})

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/check", `{"answer":"Salak"}`, "")
	if status != http.StatusOK || body["result"] != "valid" {
		t.Fatalf("check = %d %v", status, body)
	}
	ctx := backend.called("deep_cut_check_context")
	if len(ctx) != 1 || ctx[0].payload["p_answer"] != "Salak" || ctx[0].payload["p_judge_key"] != "judge-key" || ctx[0].token != "" {
		t.Fatalf("check context calls = %+v", ctx)
	}
	if len(backend.called("deep_cut_check")) != 2 || len(backend.called("deep_cut_answer")) != 0 {
		t.Fatalf("calls = %+v", backend.calls)
	}
}

func TestDeepCutCheckStaysUnknownWhenTheJudgeFails(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_check":         {`{"outcome":"checked","result":"unknown"}`},
		"deep_cut_check_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","answer":"Zzz","key":"zzz","known":[]}`},
	}}
	server := deepCutServer(t, backend, &deepCutJudging{judge: &fakeJudge{err: errors.New("down")}, key: "k"})

	status, body := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/check", `{"answer":"Zzz"}`, "")
	if status != http.StatusOK || body["result"] != "unknown" {
		t.Fatalf("check = %d %v", status, body)
	}
	if len(backend.called("deep_cut_check")) != 1 || len(backend.called("deep_cut_record_review")) != 0 {
		t.Fatalf("calls = %+v", backend.calls)
	}
}

func TestDeepCutCheckRefusesALongAnswer(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend()}
	server := deepCutServer(t, backend, nil)
	long := `{"answer":"` + "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" + `"}`
	status, _ := post(t, server, "/api/v1/deep-cut/runs/"+deepCutRun+"/questions/0/check", long, "")
	if status != http.StatusBadRequest || len(backend.calls) != 0 {
		t.Fatalf("long check = %d, calls %d", status, len(backend.calls))
	}
}
