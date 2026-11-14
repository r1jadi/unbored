package gamesessions

import (
	"errors"
	"net/http"
	"testing"

	"github.com/r1jadi/unbored/services/game-sessions/internal/deepcutjudge"
)

const deepCutParty = "eeeeeeee-3333-4333-8333-eeeeeeeeeeee"

func TestDeepCutPartyStartValidatesThePlayers(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_party_start": {`{"outcome":"started","partyId":"` + deepCutParty + `","players":4}`},
	}}
	server := deepCutServer(t, backend, nil)

	for _, body := range []string{`{"players":1}`, `{"players":9}`, `{}`} {
		if status, _ := post(t, server, "/api/v1/deep-cut/parties", body, ""); status != http.StatusBadRequest {
			t.Errorf("start %s = %d, want 400", body, status)
		}
	}
	status, body := post(t, server, "/api/v1/deep-cut/parties", `{"players":4}`, "")
	if status != http.StatusOK || body["partyId"] != deepCutParty {
		t.Fatalf("start = %d %v", status, body)
	}
	if call := backend.called("deep_cut_party_start"); len(call) != 1 || call[0].payload["p_players"] != 4 {
		t.Fatalf("start calls = %+v", call)
	}
}

func TestDeepCutPartyQuestionValidatesThePath(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_party_question": {`{"outcome":"shown","round":3,"prompt":"Name a fruit","used":[]}`},
	}}
	server := deepCutServer(t, backend, nil)

	for _, path := range []string{
		"/api/v1/deep-cut/parties/nope/rounds/0",
		"/api/v1/deep-cut/parties/" + deepCutParty + "/rounds/60",
		"/api/v1/deep-cut/parties/" + deepCutParty + "/rounds/-1",
	} {
		if status, _ := post(t, server, path, `{}`, ""); status != http.StatusBadRequest {
			t.Errorf("%s = %d, want 400", path, status)
		}
	}
	status, body := post(t, server, "/api/v1/deep-cut/parties/"+deepCutParty+"/rounds/3", `{}`, "")
	if status != http.StatusOK || body["prompt"] != "Name a fruit" {
		t.Fatalf("question = %d %v", status, body)
	}
}

func TestDeepCutPartyRefusalsMapToHTTP(t *testing.T) {
	for outcome, want := range map[string]int{
		"not_found":     http.StatusNotFound,
		"out_of_order":  http.StatusConflict,
		"not_available": http.StatusUnprocessableEntity,
	} {
		backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
			"deep_cut_party_question": {`{"outcome":"` + outcome + `"}`},
		}}
		server := deepCutServer(t, backend, nil)
		if status, _ := post(t, server, "/api/v1/deep-cut/parties/"+deepCutParty+"/rounds/0", `{}`, ""); status != want {
			t.Errorf("%s = %d, want %d", outcome, status, want)
		}
	}
}

func TestDeepCutPartyAnswerNeedsAPlayer(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend()}
	server := deepCutServer(t, backend, nil)
	for _, body := range []string{`{"answer":"Apple"}`, `{"player":8,"answer":"Apple"}`, `{"player":-1,"answer":"Apple"}`} {
		if status, _ := post(t, server, "/api/v1/deep-cut/parties/"+deepCutParty+"/rounds/0/answers", body, ""); status != http.StatusBadRequest {
			t.Errorf("answer %s = %d, want 400", body, status)
		}
	}
	if len(backend.calls) != 0 {
		t.Fatal("an invalid answer reached the database")
	}
}

func TestDeepCutPartyAnswerPassesTheVerdictThrough(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_party_answer": {`{"outcome":"judged","result":"repeat","canonical":"Apple"}`},
	}}
	judge := &fakeJudge{}
	server := deepCutServer(t, backend, &deepCutJudging{judge: judge, key: "k"})

	status, body := post(t, server, "/api/v1/deep-cut/parties/"+deepCutParty+"/rounds/2/answers",
		`{"player":3,"answer":" apples "}`, token(t, testUserID))
	if status != http.StatusOK || body["result"] != "repeat" || body["canonical"] != "Apple" {
		t.Fatalf("answer = %d %v", status, body)
	}
	call := backend.called("deep_cut_party_answer")[0]
	if call.payload["p_player"] != 3 || call.payload["p_round"] != 2 || call.payload["p_answer"] != "apples" || call.token == "" {
		t.Fatalf("answer call = %+v", call)
	}
	if len(judge.asked) != 0 {
		t.Fatal("a judged answer consulted the judge")
	}
}

func TestDeepCutPartyUnknownAnswerIsJudgedThenRetried(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_party_answer": {
			`{"outcome":"judged","result":"unknown"}`,
			`{"outcome":"judged","result":"valid","canonical":"Snake fruit","tier":5,"points":80}`,
		},
		"deep_cut_party_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","answer":"Salak","key":"salak","known":["Apple"]}`},
		"deep_cut_record_review": {`"accepted"`},
	}}
	judge := &fakeJudge{ruling: deepcutjudge.Ruling{Valid: true, Canonical: "Snake fruit", Tier: 5}}
	server := deepCutServer(t, backend, &deepCutJudging{judge: judge, key: "judge-key"})

	status, body := post(t, server, "/api/v1/deep-cut/parties/"+deepCutParty+"/rounds/0/answers", `{"player":0,"answer":"Salak"}`, "")
	if status != http.StatusOK || body["result"] != "valid" || body["points"] != float64(80) {
		t.Fatalf("answer = %d %v", status, body)
	}
	if ctx := backend.called("deep_cut_party_context"); len(ctx) != 1 || ctx[0].payload["p_judge_key"] != "judge-key" || ctx[0].token != "" {
		t.Fatalf("context calls = %+v", ctx)
	}
	if len(backend.called("deep_cut_party_answer")) != 2 {
		t.Fatalf("answer calls = %+v", backend.calls)
	}
}

func TestDeepCutPartyJudgeFailureLeavesItUnknown(t *testing.T) {
	backend := &fakeDeepCut{fakeBackend: testBackend(), answers: map[string][]string{
		"deep_cut_party_answer":  {`{"outcome":"judged","result":"unknown"}`},
		"deep_cut_party_context": {`{"outcome":"held","questionId":4,"prompt":"Name a fruit","answer":"Zzz","key":"zzz","known":[]}`},
	}}
	server := deepCutServer(t, backend, &deepCutJudging{judge: &fakeJudge{err: errors.New("down")}, key: "k"})
	status, body := post(t, server, "/api/v1/deep-cut/parties/"+deepCutParty+"/rounds/0/answers", `{"player":1,"answer":"Zzz"}`, "")
	if status != http.StatusOK || body["result"] != "unknown" || len(backend.called("deep_cut_party_answer")) != 1 {
		t.Fatalf("answer = %d %v calls %+v", status, body, backend.calls)
	}
}
