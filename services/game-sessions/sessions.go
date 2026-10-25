// Package gamesessions is the play-session service: it issues a run, and it
// accepts a finished one.
//
// Three decisions shape everything here.
//
//   - **The database is the authority, and this service holds no master key.**
//     `public.start_game_session` picks the seed, and the verifier for the run's
//     pinned rules (`complete_stack10_run`, `complete_chain_run`,
//     `complete_memory_flash_run`, `complete_one_move_run`,
//     `complete_color_merge_run`, `complete_dont_touch_run`,
//     `complete_seven_second_run`, `complete_queens_run`, `complete_zip_run`)
//     replays the submitted actions, derives the
//     score and writes the ledger. This service validates
//     the request shape, maps the verifier's outcome onto an HTTP answer, and
//     never sees a score it can change. That is why there is no service_role key
//     anywhere in the configuration: a credential that bypasses every policy is a
//     much larger
//     thing to hand out than a verifier the database already owns.
//
//   - **The caller's own token is the credential.** Both writes go to the Data
//     API with the access token the request arrived with, so `auth.uid()` inside
//     those functions *is* the caller. A body can therefore never name a user,
//     and a guest run (no token) is verified and closed without ever becoming a
//     ranked score.
//
//   - **A refusal is data, not an exception.** The verifier answers with an
//     outcome — `recorded`, `duplicate`, `expired`, `score_mismatch`, and so on —
//     and this service is the only place that decides what each one means over
//     HTTP: a retry that must be safe, a closed run that must not be replaced, a
//     claim the replay contradicts.
package gamesessions

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/game-sessions/internal/supabaseplay"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

// Name is the service's name in logs, configuration and the routing table.
const Name = "game-sessions"

const (
	// maxBodyBytes bounds a request body: a finite run is a few hundred bytes, the
	// longest endless run is 4096 moves — about 20 KiB of JSON — and a Queens run
	// may carry 8192 cell taps of at most two digits, about 25 KiB, so the
	// ceiling has room without inviting an absurd body.
	maxBodyBytes = 64 * 1024
	// maxActions bounds the moves in an ordinary run: sixty tiles for Stack 10,
	// fifty-five taps for a perfect Memory Flash or legacy Chain run, twelve taps
	// for a perfect One Move run, forty-eight slides for Color Merge, sixty cell
	// taps for a complete legacy Don't Touch the Black deck, and sixty answers for
	// 7 Second. The verifier enforces its own game's bound too; this only keeps an
	// absurd body from reaching the database at all.
	maxActions = 60
	// The endless games' submission bounds. These are request ceilings rather than
	// complete-run lengths: stack-10@2, chain@2, color-merge@2, memory-flash@2 and
	// one-move@2 carry at most 4096 moves, and dont-touch@2 at most 4095 cell taps
	// (a cell can be tapped once). Every other runtime keeps the bound its own
	// verifier owns.
	stack10MaxActions     = 4096
	chainMaxActions       = 4096
	colorMergeMaxActions  = 4096
	memoryFlashMaxActions = 4096
	oneMoveMaxActions     = 4096
	dontTouchMaxActions   = 4095
	// queens@1 carries at most 8192 taps: notes (Xs) are taps too, so a long run
	// spends more of them per board than the other endless games do.
	queensMaxActions = 8192
	// zip@1 carries at most 8192 cells: every cell a drawn path enters is one.
	zipMaxActions = 8192
	// The bounds a move has to fit. Stack 10 addresses a column and Chain a pad,
	// both 0 to 3; Color Merge addresses one of its four directions, also 0 to 3;
	// Memory Flash addresses a cell of its board — sixteen for the retired 4×4
	// rules, the largest board the endless rules can reach for memory-flash@2
	// (fifteen by fifteen at the submission bound); One Move addresses a cell of
	// its board — twenty-five cells for the retired 5×5 maximum, and for
	// one-move@2 the 1026×1026 board the submission bound can reach; Don't Touch
	// the Black addresses its deck's cells — sixty for the legacy rules, 4095 for
	// the endless conveyor. The pinned rules version picks the bound, because the
	// games live behind one endpoint.
	stackChainPositions     = 4
	colorMergeDirections    = 4
	memoryFlashCells        = 16
	memoryFlashEndlessCells = 225
	oneMoveCells            = 25
	// 1026², the side of the board at level 4096: one correct tap per level is
	// the only way to reach the bound, and the level's side is 3 + (level-1)/4.
	oneMoveEndlessCells = 1026 * 1026
	// dontTouchCells is the legacy dont-touch@1 deck; dont-touch@2 addresses the
	// endless conveyor's 4095 cells.
	dontTouchCells     = 60
	dontTouchMaxCells  = 4095
	sevenSecondChoices = 3
	// queensCells is the largest Queens board, 9×9: boards grow from 5×5 and stop
	// there.
	queensCells = 81
	// zipCells is the largest Zip board, 7×7.
	zipCells = 49
)

// Patterns mirror the database constraints, so a bad request is a 400 that names
// the field instead of a 500 raised by a function.
var (
	gameSlugPattern     = regexp.MustCompile(`^[a-z0-9-]{2,48}$`)
	rulesVersionPattern = regexp.MustCompile(`^[a-z0-9-]{2,32}@[0-9]{1,4}$`)
	sessionIDPattern    = regexp.MustCompile(`^[0-9a-f-]{36}$`)
)

// ── The database surface this service needs ──────────────────────────────────
//
// The request and verdict types live in the play client, which is where a
// database row becomes an API-shaped value — the same split the catalogue uses.
// What this package owns is the decision of what each verdict means over HTTP.

// Backend is the play surface this service needs. It is an interface so the
// handlers are tested without a network, and so a deployment that was not given
// Supabase credentials still boots, serves its probes, and answers 503 on the
// session routes instead of crash-looping.
type Backend interface {
	StartSession(ctx context.Context, request supabaseplay.StartRequest) (supabaseplay.Start, error)
	CompleteRun(ctx context.Context, request supabaseplay.CompleteRequest) (supabaseplay.Result, error)
}

// ── Response shapes ─────────────────────────────────────────────────────────

// sessionView is an issued run as the API exposes it. It carries no user id:
// the caller is the token, and the client already knows who it is.
type sessionView struct {
	ID           string `json:"id"`
	GameSlug     string `json:"gameSlug"`
	RulesVersion string `json:"rulesVersion"`
	// Seed is a decimal string, exactly as the database holds it. See Start.Seed.
	Seed      string    `json:"seed"`
	TileCount int       `json:"tileCount"`
	StartedAt time.Time `json:"startedAt"`
	ExpiresAt time.Time `json:"expiresAt"`
	// Ranked is false for a guest run: it is played and verified, and it is not
	// eligible for a score.
	Ranked bool `json:"ranked"`
}

// resultView is a finished run as the API exposes it. `duplicate` is true when
// the submission was a retry of the run already recorded, which is the same
// answer to the client — the score — and a different fact about the request.
type resultView struct {
	SessionID      string    `json:"sessionId"`
	GameSlug       string    `json:"gameSlug"`
	Score          int64     `json:"score"`
	ClearedColumns int       `json:"clearedColumns"`
	TilesPlaced    int       `json:"tilesPlaced"`
	DurationMS     int       `json:"durationMs"`
	Ranked         bool      `json:"ranked"`
	RecordedAt     time.Time `json:"recordedAt"`
	PersonalBest   *int64    `json:"personalBest"`
	Rank           *int64    `json:"rank"`
	Duplicate      bool      `json:"duplicate"`
}

// ── Handlers ────────────────────────────────────────────────────────────────

type service struct {
	backend Backend
	logger  *slog.Logger
}

func newService(backend Backend, logger *slog.Logger) *service {
	return &service{backend: backend, logger: logger}
}

// register mounts the session routes. Both are optional-auth: a visitor without
// an account can play, and their run is verified and left unranked.
func (s *service) register(router *httpx.Router) {
	router.OptionalAuthFunc("POST /api/v1/sessions", s.startSession)
	router.OptionalAuthFunc("POST /api/v1/sessions/{sessionID}/complete", s.completeSession)
}

// startSessionRequest is the documented body: the game by slug, the rules the
// client intends to play, and who is playing. No user id and no seed — both are
// the server's.
type startSessionRequest struct {
	GameSlug     string `json:"gameSlug"`
	RulesVersion string `json:"rulesVersion"`
	Client       string `json:"client"`
}

func (s *service) startSession(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "start a run")
		return
	}

	var body startSessionRequest
	if err := httpx.DecodeJSON(w, r, maxBodyBytes, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	slug := strings.TrimSpace(body.GameSlug)
	if !gameSlugPattern.MatchString(slug) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid game slug.",
			apierr.Detail{Field: "gameSlug", Rule: "format"}))
		return
	}

	rules := strings.TrimSpace(body.RulesVersion)
	if !rulesVersionPattern.MatchString(rules) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid rules version.",
			apierr.Detail{Field: "rulesVersion", Rule: "format"}))
		return
	}

	client := strings.TrimSpace(body.Client)
	if len(client) > 40 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"client is longer than 40 characters.",
			apierr.Detail{Field: "client", Rule: "length"}))
		return
	}

	start, err := s.backend.StartSession(r.Context(), supabaseplay.StartRequest{
		GameSlug:     slug,
		RulesVersion: rules,
		Client:       client,
		AccessToken:  callerToken(r),
	})
	if err != nil {
		s.dataFailure(w, r, "start a run", err)
		return
	}

	switch start.Outcome {
	case "started":
		httpx.WriteJSON(w, r, http.StatusCreated, sessionView{
			ID:           start.ID,
			GameSlug:     start.GameSlug,
			RulesVersion: start.RulesVersion,
			Seed:         start.Seed,
			TileCount:    start.TileCount,
			StartedAt:    start.StartedAt,
			ExpiresAt:    start.ExpiresAt,
			Ranked:       start.Ranked,
		})
	case "not_playable":
		// An unpublished game, a game with no runtime, and a slug that does not
		// exist answer identically. Telling them apart would let a stranger
		// enumerate drafts.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound,
			"No playable game with that slug."))
	case "unsupported_runtime":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That game's rules version is not one this server can verify.",
			apierr.Detail{Field: "rulesVersion", Rule: "unsupported"}))
	case "already_played":
		// The daily limit is a rule, not a failure: 409 says the request conflicts
		// with the state of the player's day, which is exactly what happened, and
		// the message tells them when the next attempt arrives.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
			"You've already played today's challenge. The next deck arrives at midnight UTC."))
	default:
		s.unexpectedOutcome(w, r, "start a run", start.Outcome)
	}
}

// completeSessionRequest is the documented body: the score the client believes
// it earned, how long the run took, and the run itself inside `progress`. The
// claimed score is a claim — the verifier compares it against its own replay.
type completeSessionRequest struct {
	Score      *int64 `json:"score"`
	DurationMS *int   `json:"durationMs"`
	Progress   *struct {
		RulesVersion string  `json:"rulesVersion"`
		Actions      []int32 `json:"actions"`
	} `json:"progress"`
}

func (s *service) completeSession(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "submit a run")
		return
	}

	sessionID := strings.TrimSpace(r.PathValue("sessionID"))
	if !sessionIDPattern.MatchString(sessionID) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid session id.",
			apierr.Detail{Field: "sessionID", Rule: "format"}))
		return
	}

	var body completeSessionRequest
	if err := httpx.DecodeJSON(w, r, maxBodyBytes, &body); err != nil {
		httpx.WriteError(w, r, err)
		return
	}

	if body.Score == nil || *body.Score < 0 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"score must be a whole number of zero or more.",
			apierr.Detail{Field: "score", Rule: "range"}))
		return
	}
	if body.DurationMS == nil || *body.DurationMS < 1 {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"durationMs must be a positive number of milliseconds.",
			apierr.Detail{Field: "durationMs", Rule: "range"}))
		return
	}
	if body.Progress == nil {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"progress is required: the run has to be submitted to be verified.",
			apierr.Detail{Field: "progress", Rule: "required"}))
		return
	}

	rules := strings.TrimSpace(body.Progress.RulesVersion)
	if !rulesVersionPattern.MatchString(rules) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid rules version.",
			apierr.Detail{Field: "progress.rulesVersion", Rule: "format"}))
		return
	}

	actions := body.Progress.Actions
	limit := maxActions
	switch {
	case rules == "stack-10@2":
		limit = stack10MaxActions
	case rules == "chain@2":
		limit = chainMaxActions
	case rules == "color-merge@2":
		limit = colorMergeMaxActions
	case rules == "memory-flash@2":
		limit = memoryFlashMaxActions
	case rules == "one-move@2":
		limit = oneMoveMaxActions
	case strings.HasPrefix(rules, "dont-touch@") && rules != "dont-touch@1":
		limit = dontTouchMaxActions
	case strings.HasPrefix(rules, "queens@"):
		limit = queensMaxActions
	case strings.HasPrefix(rules, "zip@"):
		limit = zipMaxActions
	}
	if len(actions) > limit {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That run has more moves than a submission can carry.",
			apierr.Detail{Field: "progress.actions", Rule: "length"}))
		return
	}
	// A move outside the board is malformed input rather than a bad run;
	// whether the *sequence* is possible is the verifier's call, not this one's.
	// The board the pinned rules play on decides the bound: One Move has up to
	// twenty-five cells, Memory Flash sixteen, Stack 10 and Chain four positions.
	positions := boardSize(rules)
	for _, action := range actions {
		if action < 0 || int(action) >= positions {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				fmt.Sprintf("Every action must be a board position from 0 to %d.", positions-1),
				apierr.Detail{Field: "progress.actions", Rule: "range"}))
			return
		}
	}

	result, err := s.backend.CompleteRun(r.Context(), supabaseplay.CompleteRequest{
		SessionID:    sessionID,
		RulesVersion: rules,
		Actions:      actions,
		Score:        *body.Score,
		DurationMS:   *body.DurationMS,
		AccessToken:  callerToken(r),
	})
	if err != nil {
		s.dataFailure(w, r, "submit a run", err)
		return
	}

	switch result.Outcome {
	case "recorded", "duplicate":
		httpx.WriteJSON(w, r, http.StatusOK, resultView{
			SessionID:      result.SessionID,
			GameSlug:       result.GameSlug,
			Score:          deref(result.Score),
			ClearedColumns: deref(result.ClearedColumns),
			TilesPlaced:    deref(result.TilesPlaced),
			DurationMS:     deref(result.DurationMS),
			Ranked:         deref(result.Ranked),
			RecordedAt:     deref(result.RecordedAt),
			PersonalBest:   result.PersonalBest,
			Rank:           result.Rank,
			Duplicate:      result.Outcome == "duplicate",
		})
	case "not_found":
		// Someone else's session and a session that never existed are the same
		// answer, so run ids cannot be probed for existence.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound, "No such run."))
	case "expired":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
			"That run expired before it was submitted. Start a new one."))
	case "abandoned":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
			"That run was replaced by a newer one. Only the open run can be submitted."))
	case "closed":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
			"That run was already recorded, and a different submission cannot replace it."))
	case "wrong_rules":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
			"That run was started under different rules and cannot be verified now."))
	case "invalid_actions":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That run does not follow the rules, so it cannot be scored."))
	case "invalid_duration":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That run claims to have lasted longer than the session has existed."))
	case "score_mismatch":
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That score is not the one this run produces."))
	case "out_of_time":
		// Zip only: the run reached the server later than the clock its solved
		// boards earned, timed from the session's own start.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That run finished after its clock ran out, so it cannot be scored."))
	case "already_played":
		// One ranked attempt a day is enforced at the ledger too, so two sessions
		// of the same day's deck cannot both become scores even if their starts
		// raced. The first completion is the one that counts.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
			"You've already completed today's challenge. Only the first run counts."))
	default:
		s.unexpectedOutcome(w, r, "submit a run", result.Outcome)
	}
}

// boardSize is how many positions the pinned rules address. The rules version
// is what selects a replay in the database, so it is also what selects the board
// here; an unknown version keeps the smallest bound, and the verifier refuses the
// run as `wrong_rules` rather than this layer guessing.
func boardSize(rulesVersion string) int {
	switch {
	case rulesVersion == "memory-flash@1":
		return memoryFlashCells
	case strings.HasPrefix(rulesVersion, "memory-flash@"):
		return memoryFlashEndlessCells
	case rulesVersion == "one-move@1":
		return oneMoveCells
	case strings.HasPrefix(rulesVersion, "one-move@"):
		return oneMoveEndlessCells
	case strings.HasPrefix(rulesVersion, "color-merge@"):
		return colorMergeDirections
	case rulesVersion == "dont-touch@1":
		return dontTouchCells
	case strings.HasPrefix(rulesVersion, "dont-touch@"):
		return dontTouchMaxCells
	case strings.HasPrefix(rulesVersion, "seven-second@"):
		return sevenSecondChoices
	case strings.HasPrefix(rulesVersion, "queens@"):
		return queensCells
	case strings.HasPrefix(rulesVersion, "zip@"):
		return zipCells
	default:
		return stackChainPositions
	}
}

func deref[T any](value *T) T {
	if value == nil {
		return *new(T)
	}
	return *value
}

// ── Caller identity and failure reporting ───────────────────────────────────

// callerToken is the caller's own access token, forwarded so the database can
// answer as that caller. It is never stored, logged or reused.
func callerToken(r *http.Request) string {
	return authn.BearerToken(r.Header.Get("Authorization"))
}

// notConfigured is the answer when the deployment has no Supabase credentials:
// a 503 that says the feature is unavailable, not a 404 that would suggest the
// route does not exist.
func (s *service) notConfigured(w http.ResponseWriter, r *http.Request, operation string) {
	s.logger.WarnContext(r.Context(), "play sessions are not configured", slog.String("operation", operation))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Play sessions are not available right now."))
}

// dataFailure logs the operation and the transport error and answers 503. The
// error is logged, never returned: it can carry the upstream status and codes,
// which are not the caller's business.
func (s *service) dataFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	s.logger.ErrorContext(r.Context(), "play session call failed",
		slog.String("operation", operation),
		slog.Any("error", err),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Play sessions are not available right now."))
}

// unexpectedOutcome is the only honest answer to an outcome this service does not
// know: the run's state is unclear, so it must not be reported as success.
func (s *service) unexpectedOutcome(w http.ResponseWriter, r *http.Request, operation, outcome string) {
	s.logger.ErrorContext(r.Context(), "unrecognised play outcome",
		slog.String("operation", operation),
		slog.String("outcome", outcome),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeInternal, "Something went wrong on our side."))
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Options returns the wiring every game-sessions entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, _ *authn.Verifier) {
			var backend Backend
			client, err := supabaseplay.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its
				// probes and answers 503 on the session routes, which is far
				// more diagnosable than a crash loop. The error names the
				// missing variables and carries no value.
				logger.Warn("Supabase play sessions are not configured; the session routes answer 503",
					slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, logger).register(router)
		},
	}
}
