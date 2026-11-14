package gamesessions

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
)

// Deep Cut Party is hot potato, pass-and-play on one device. The server deals a
// question per round and judges each answer; the fuse, the turns and who is out
// live on the device. Each route is a pass-through to a database function that
// runs as the caller:
//
//   - POST /deep-cut/parties starts a party for 2–8 players (`deep_cut_party_start`).
//   - POST /deep-cut/parties/{partyID}/rounds/{round} deals a round's question
//     (`deep_cut_party_question`).
//   - POST /deep-cut/parties/{partyID}/rounds/{round}/answers judges one player's
//     answer (`deep_cut_party_answer`). A spelling nobody has judged is put to the
//     AI judge first, and its ruling cached for everyone, as a daily answer's is.

const deepCutPartyRounds = 60

func (s *service) registerDeepCutParty(router *httpx.Router) {
	router.OptionalAuthFunc("POST /api/v1/deep-cut/parties", s.deepCutPartyStart)
	router.OptionalAuthFunc("POST /api/v1/deep-cut/parties/{partyID}/rounds/{round}", s.deepCutPartyQuestion)
	router.OptionalAuthFunc("POST /api/v1/deep-cut/parties/{partyID}/rounds/{round}/answers", s.deepCutPartyAnswer)
}

// partyAndRound validates the path: a party id shaped like a uuid and a round 0–59.
func partyAndRound(w http.ResponseWriter, r *http.Request) (string, int, bool) {
	partyID := strings.ToLower(r.PathValue("partyID"))
	if !sessionIDPattern.MatchString(partyID) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid party id.", apierr.Detail{Field: "partyID", Rule: "format"}))
		return "", 0, false
	}
	round, err := strconv.Atoi(r.PathValue("round"))
	if err != nil || round < 0 || round >= deepCutPartyRounds {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A round number is 0 to 59.", apierr.Detail{Field: "round", Rule: "range"}))
		return "", 0, false
	}
	return partyID, round, true
}

// writeDeepCutParty answers with the function's object, or the HTTP error its
// outcome means.
func (s *service) writeDeepCutParty(w http.ResponseWriter, r *http.Request, operation string, raw json.RawMessage, ok string) {
	switch outcomeOf(raw) {
	case ok:
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, r, http.StatusOK, raw)
	case "not_found":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound, "No Deep Cut party with that id is yours to play. It may have ended."))
	case "out_of_order", "not_shown":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "Rounds come one at a time, in order."))
	case "invalid_players":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A party has 2 to 8 players.", apierr.Detail{Field: "players", Rule: "range"}))
	case "invalid_player":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That player is not in this party.", apierr.Detail{Field: "player", Rule: "range"}))
	case "invalid_answer":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"An answer is at most 60 characters.", apierr.Detail{Field: "answer", Rule: "length"}))
	case "invalid_round":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest, "That request is not valid."))
	case "not_available":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable, "There are no more questions for this party. Start a new one."))
	default:
		s.unexpectedOutcome(w, r, operation, outcomeOf(raw))
	}
}

type deepCutPartyStartRequest struct {
	Players int `json:"players"`
}

func (s *service) deepCutPartyStart(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "start a Deep Cut party") {
		return
	}
	var body deepCutPartyStartRequest
	if err := httpx.DecodeJSON(w, r, 1024, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if body.Players < 2 || body.Players > 8 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A party has 2 to 8 players.", apierr.Detail{Field: "players", Rule: "range"}))
		return
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_party_start",
		map[string]any{"p_players": body.Players}, callerToken(r))
	if err != nil {
		s.dataFailure(w, r, "start a Deep Cut party", err)
		return
	}
	s.writeDeepCutParty(w, r, "start a Deep Cut party", raw, "started")
}

func (s *service) deepCutPartyQuestion(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "deal a Deep Cut party round") {
		return
	}
	partyID, round, ok := partyAndRound(w, r)
	if !ok {
		return
	}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_party_question",
		map[string]any{"p_party_id": partyID, "p_round": round}, callerToken(r))
	if err != nil {
		s.dataFailure(w, r, "deal a Deep Cut party round", err)
		return
	}
	s.writeDeepCutParty(w, r, "deal a Deep Cut party round", raw, "shown")
}

type deepCutPartyAnswerRequest struct {
	Player *int    `json:"player"`
	Answer *string `json:"answer"`
}

func (s *service) deepCutPartyAnswer(w http.ResponseWriter, r *http.Request) {
	if !s.deepCutReady(w, r, "judge a Deep Cut party answer") {
		return
	}
	partyID, round, ok := partyAndRound(w, r)
	if !ok {
		return
	}
	var body deepCutPartyAnswerRequest
	if err := httpx.DecodeJSON(w, r, 4*1024, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if body.Player == nil || *body.Player < 0 || *body.Player > 7 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"Say which player is answering, 0 to 7.", apierr.Detail{Field: "player", Rule: "range"}))
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
	payload := map[string]any{"p_party_id": partyID, "p_round": round, "p_player": *body.Player, "p_answer": answer}
	raw, err := s.deepCut.DeepCut(r.Context(), "deep_cut_party_answer", payload, token)
	if err != nil {
		s.dataFailure(w, r, "judge a Deep Cut party answer", err)
		return
	}
	if outcomeOf(raw) == "judged" && checkResultOf(raw) == "unknown" && s.judging != nil {
		if s.consultJudgeOnParty(r.Context(), partyID, round, answer) {
			raw, err = s.deepCut.DeepCut(r.Context(), "deep_cut_party_answer", payload, token)
			if err != nil {
				s.dataFailure(w, r, "judge a Deep Cut party answer", err)
				return
			}
		}
	}
	s.writeDeepCutParty(w, r, "judge a Deep Cut party answer", raw, "judged")
}

// consultJudgeOnParty asks the judge about an unjudged party answer and records
// the ruling. It reports whether a ruling was recorded.
func (s *service) consultJudgeOnParty(parent context.Context, partyID string, round int, answer string) bool {
	ctx, cancel := context.WithTimeout(parent, judgeTimeout)
	defer cancel()
	raw, err := s.deepCut.DeepCut(ctx, "deep_cut_party_context", map[string]any{
		"p_judge_key": s.judging.key, "p_party_id": partyID, "p_round": round, "p_answer": answer,
	}, "")
	if err != nil {
		s.logger.ErrorContext(ctx, "deep cut party context failed", slog.Any("error", err))
		return false
	}
	return s.ruleAndRecord(ctx, raw)
}
