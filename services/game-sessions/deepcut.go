package gamesessions

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/game-sessions/internal/deepcutjudge"
)

// Deep Cut is the one game whose rules cannot travel to the browser: its answer
// bank is its score. So beside the ordinary session routes it has these, each a
// thin pass-through to a database function that runs as the caller:
//
//   - POST /deep-cut/runs/{runID}/questions/{position} deals a question and
//     starts its clock (`deep_cut_reveal`). A daily run's id is its session id.
//   - POST /deep-cut/runs/{runID}/questions/{position}/check says whether an
//     answer would count, before it is submitted (`deep_cut_check`). It records
//     nothing; a spelling nobody has judged is put to the AI judge first.
//   - POST /deep-cut/runs/{runID}/questions/{position}/answer judges one answer
//     (`deep_cut_answer`). An answer the bank has never seen is held while the AI
//     judge rules on it — once, cached for everyone — and then settled.
//   - POST /deep-cut/practice starts an unranked Unlimited or Archive run, and
//     GET /deep-cut/archive lists the days the archive can deal.
//   - POST /deep-cut/runs/{runID}/summary ends a practice run and totals it.
//
// A daily run is completed through the ordinary `POST /sessions/{id}/complete`.

// DeepCutBackend is the Deep Cut surface of the database.
type DeepCutBackend interface {
	DeepCut(ctx context.Context, function string, payload map[string]any, accessToken string) (json.RawMessage, error)
}

// deepCutJudging is the optional AI fallback: the judge and the key the database
// expects from it. Both or neither.
type deepCutJudging struct {
	judge deepcutjudge.Judge
	key   string
}

const (
	deepCutPositions = 7
	maxAnswerRunes   = 60
	// How long an answer may wait for the judge: inside the question's grace.
	judgeTimeout = 6 * time.Second
)

func (s *service) registerDeepCut(router *httpx.Router) {
	router.OptionalAuthFunc("POST /api/v1/deep-cut/practice", s.deepCutPractice)
	router.OptionalAuthFunc("GET /api/v1/deep-cut/archive", s.deepCutArchive)
	router.OptionalAuthFunc("POST /api/v1/deep-cut/runs/{runID}/questions/{position}", s.deepCutReveal)
	router.OptionalAuthFunc("POST /api/v1/deep-cut/runs/{runID}/questions/{position}/check", s.deepCutCheck)
	router.OptionalAuthFunc("POST /api/v1/deep-cut/runs/{runID}/questions/{position}/answer", s.deepCutAnswer)
	router.OptionalAuthFunc("POST /api/v1/deep-cut/runs/{runID}/summary", s.deepCutSummary)
	s.registerDeepCutParty(router)
}

// outcomeOf reads the `outcome` a Deep Cut function answered with.
func outcomeOf(raw json.RawMessage) string {
	var head struct {
		Outcome string `json:"outcome"`
	}
	_ = json.Unmarshal(raw, &head)
	return head.Outcome
}

func (s *service) deepCutReady(w http.ResponseWriter, r *http.Request, operation string) bool {
	if s.deepCut == nil {
		s.notConfigured(w, r, operation)
		return false
	}
	return true
}

// runAndPosition validates the path: a run id shaped like a uuid, and a question
// number 0–6.
func runAndPosition(w http.ResponseWriter, r *http.Request) (string, int, bool) {
	runID := strings.ToLower(r.PathValue("runID"))
	if !sessionIDPattern.MatchString(runID) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid run id.", apierr.Detail{Field: "runID", Rule: "format"}))
		return "", 0, false
	}
	position, err := strconv.Atoi(r.PathValue("position"))
	if err != nil || position < 0 || position >= deepCutPositions {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A question number is 0 to 6.", apierr.Detail{Field: "position", Rule: "range"}))
		return "", 0, false
	}
	return runID, position, true
}

// writeDeepCut answers with the function's object, or the HTTP error its outcome
// means. `ok` lists the outcomes that are a success for this route.
func (s *service) writeDeepCut(w http.ResponseWriter, r *http.Request, operation string, raw json.RawMessage, ok ...string) {
	outcome := outcomeOf(raw)
	for _, want := range ok {
		if outcome == want {
			w.Header().Set("Cache-Control", "no-store")
			httpx.WriteJSON(w, r, http.StatusOK, raw)
			return
		}
	}
	switch outcome {
	case "not_found":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound, "No Deep Cut run with that id is yours to play."))
	case "expired":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "That run has expired. Start a new one."))
	case "closed":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "That run is finished."))
	case "out_of_order", "not_shown":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "Questions come one at a time, in order."))
	case "already_answered":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "That question already has your answer."))
	case "invalid_answer":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"An answer is at most 60 characters.", apierr.Detail{Field: "answer", Rule: "length"}))
	case "invalid_position", "invalid_mode":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest, "That request is not valid."))
	case "not_available":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable, "That day can't be played from the archive right now."))
	default:
		s.unexpectedOutcome(w, r, operation, outcome)
	}
}

func (s *service) deepCutReveal(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "deal a Deep Cut question") {
		return
	}
	runID, position, ok := runAndPosition(w, r)
	if !ok {
		return
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_reveal",
		map[string]any{"p_run_id": runID, "p_position": position}, callerToken(r))
	if err != nil {
		s.dataFailure(w, r, "deal a Deep Cut question", err)
		return
	}
	s.writeDeepCut(w, r, "deal a Deep Cut question", raw, "shown")
}

type deepCutAnswerRequest struct {
	Answer *string `json:"answer"`
}

func (s *service) deepCutAnswer(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "judge a Deep Cut answer") {
		return
	}
	runID, position, ok := runAndPosition(w, r)
	if !ok {
		return
	}
	var body deepCutAnswerRequest
	if err := httpx.DecodeJSON(w, r, 4*1024, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	answer := ""
	if body.Answer != nil {
		answer = strings.TrimSpace(*body.Answer)
	}
	if len([]rune(answer)) > maxAnswerRunes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"An answer is at most 60 characters.", apierr.Detail{Field: "answer", Rule: "length"}))
		return
	}

	token := callerToken(r)
	payload := map[string]any{
		"p_run_id": runID, "p_position": position, "p_answer": answer,
		// Without a judge there is nothing to wait for: settle at once.
		"p_final": s.judging == nil,
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_answer", payload, token)
	if err != nil {
		s.dataFailure(w, r, "judge a Deep Cut answer", err)
		return
	}

	if outcomeOf(raw) == "unknown" && s.judging != nil {
		s.consultJudge(r.Context(), runID, position)
		settle := map[string]any{"p_run_id": runID, "p_position": position, "p_answer": answer, "p_final": true}
		raw, err = s.deepCut.DeepCut(r.Context(), "deep_cut_answer", settle, token)
		if err != nil {
			s.dataFailure(w, r, "judge a Deep Cut answer", err)
			return
		}
	}
	s.writeDeepCut(w, r, "judge a Deep Cut answer", raw, "scored")
}

// deepCutCheck answers whether an answer would count, without submitting it.
// `result` is valid, invalid, ambiguous, unknown, empty or late. An answer the
// bank has never seen is put to the judge first (its ruling is cached exactly as
// if the answer had been submitted); with no judge, or a judge that cannot rule,
// it stays `unknown` and the client lets the player submit it as before.
func (s *service) deepCutCheck(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "check a Deep Cut answer") {
		return
	}
	runID, position, ok := runAndPosition(w, r)
	if !ok {
		return
	}
	var body deepCutAnswerRequest
	if err := httpx.DecodeJSON(w, r, 4*1024, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	answer := ""
	if body.Answer != nil {
		answer = strings.TrimSpace(*body.Answer)
	}
	if len([]rune(answer)) > maxAnswerRunes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"An answer is at most 60 characters.", apierr.Detail{Field: "answer", Rule: "length"}))
		return
	}

	token := callerToken(r)
	payload := map[string]any{"p_run_id": runID, "p_position": position, "p_answer": answer}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_check", payload, token)
	if err != nil {
		s.dataFailure(w, r, "check a Deep Cut answer", err)
		return
	}
	if outcomeOf(raw) == "checked" && checkResultOf(raw) == "unknown" && s.judging != nil {
		if s.consultJudgeOnCheck(r.Context(), runID, position, answer) {
			raw, err = s.deepCut.DeepCut(r.Context(), "deep_cut_check", payload, token)
			if err != nil {
				s.dataFailure(w, r, "check a Deep Cut answer", err)
				return
			}
		}
	}
	s.writeDeepCut(w, r, "check a Deep Cut answer", raw, "checked")
}

// checkResultOf reads the `result` of a `deep_cut_check` answer.
func checkResultOf(raw json.RawMessage) string {
	var head struct {
		Result string `json:"result"`
	}
	_ = json.Unmarshal(raw, &head)
	return head.Result
}

// consultJudgeOnCheck asks the judge about an answer being checked on an open
// turn and records the ruling. It reports whether a ruling was recorded.
func (s *service) consultJudgeOnCheck(parent context.Context, runID string, position int, answer string) bool {
	ctx, cancel := context.WithTimeout(parent, judgeTimeout)
	defer cancel()

	raw, err := s.deepCut.DeepCut(ctx, "deep_cut_check_context", map[string]any{
		"p_judge_key": s.judging.key, "p_run_id": runID, "p_position": position, "p_answer": answer,
	}, "")
	if err != nil {
		s.logger.ErrorContext(ctx, "deep cut check context failed", slog.Any("error", err))
		return false
	}
	return s.ruleAndRecord(ctx, raw)
}

// consultJudge asks the AI judge about a held answer and records its ruling. Any
// failure is logged and swallowed: the answer is then settled without a ruling,
// scores nothing and waits for staff, which is the same as having no judge.
func (s *service) consultJudge(parent context.Context, runID string, position int) {
	ctx, cancel := context.WithTimeout(parent, judgeTimeout)
	defer cancel()

	raw, err := s.deepCut.DeepCut(ctx, "deep_cut_judge_context", map[string]any{
		"p_judge_key": s.judging.key, "p_run_id": runID, "p_position": position,
	}, "")
	if err != nil {
		s.logger.ErrorContext(ctx, "deep cut judge context failed", slog.Any("error", err))
		return
	}
	s.ruleAndRecord(ctx, raw)
}

// ruleAndRecord puts a judge context (`deep_cut_judge_context` or
// `deep_cut_check_context`) to the judge and records its ruling. Any failure is
// logged and swallowed. It reports whether a ruling was recorded.
func (s *service) ruleAndRecord(ctx context.Context, raw json.RawMessage) bool {
	var held struct {
		Outcome    string   `json:"outcome"`
		QuestionID int      `json:"questionId"`
		Prompt     string   `json:"prompt"`
		Category   string   `json:"category"`
		Answer     string   `json:"answer"`
		Key        string   `json:"key"`
		Known      []string `json:"known"`
	}
	if err := json.Unmarshal(raw, &held); err != nil || held.Outcome != "held" {
		return false
	}

	ruling, err := s.judging.judge.Rule(ctx, deepcutjudge.Question{
		Prompt: held.Prompt, Category: held.Category, Answer: held.Answer, Known: held.Known,
	})
	if err != nil {
		level := slog.LevelError
		if errors.Is(err, deepcutjudge.ErrBusy) {
			level = slog.LevelWarn
		}
		s.logger.Log(ctx, level, "deep cut judge failed", slog.Any("error", err))
		return false
	}

	verdict := "rejected"
	var canonical, tier any
	if ruling.Valid {
		verdict, canonical, tier = "accepted", ruling.Canonical, ruling.Tier
	}
	if _, err := s.deepCut.DeepCut(ctx, "deep_cut_record_review", map[string]any{
		"p_judge_key": s.judging.key, "p_question_id": held.QuestionID, "p_key": held.Key,
		"p_sample": held.Answer, "p_verdict": verdict, "p_canonical": canonical, "p_tier": tier,
	}, ""); err != nil {
		s.logger.ErrorContext(ctx, "deep cut review could not be recorded", slog.Any("error", err))
		return false
	}
	return true
}

type deepCutPracticeRequest struct {
	Mode string `json:"mode"`
	Day  *int   `json:"day"`
}

func (s *service) deepCutPractice(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "start Deep Cut practice") {
		return
	}
	var body deepCutPracticeRequest
	if err := httpx.DecodeJSON(w, r, 1024, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if body.Mode != "unlimited" && body.Mode != "archive" {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"mode is unlimited or archive.", apierr.Detail{Field: "mode", Rule: "enum"}))
		return
	}
	if body.Mode == "archive" && body.Day == nil {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"An archive run needs a day.", apierr.Detail{Field: "day", Rule: "required"}))
		return
	}
	var day any
	if body.Mode == "archive" {
		day = *body.Day
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_start_practice",
		map[string]any{"p_mode": body.Mode, "p_day": day}, callerToken(r))
	if err != nil {
		s.dataFailure(w, r, "start Deep Cut practice", err)
		return
	}
	s.writeDeepCut(w, r, "start Deep Cut practice", raw, "started")
}

func (s *service) deepCutArchive(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "list the Deep Cut archive") {
		return
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_archive_days", map[string]any{}, callerToken(r))
	if err != nil {
		s.dataFailure(w, r, "list the Deep Cut archive", err)
		return
	}
	var days []int
	if err := json.Unmarshal(raw, &days); err != nil {
		s.dataFailure(w, r, "list the Deep Cut archive", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, map[string]any{"days": days})
}

func (s *service) deepCutSummary(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "finish Deep Cut practice") {
		return
	}
	runID := strings.ToLower(r.PathValue("runID"))
	if !sessionIDPattern.MatchString(runID) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid run id.", apierr.Detail{Field: "runID", Rule: "format"}))
		return
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_practice_summary",
		map[string]any{"p_run_id": runID}, callerToken(r))
	if err != nil {
		s.dataFailure(w, r, "finish Deep Cut practice", err)
		return
	}
	s.writeDeepCut(w, r, "finish Deep Cut practice", raw, "finished")
}
