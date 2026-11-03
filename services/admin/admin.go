// Package admin is the operations API behind the admin dashboard.
//
// What it is, and what it deliberately is not:
//
//   - **ADMIN_EMAILS is the single source of truth for administrator access.**
//     The platform middleware verifies the access token and the staff wrapper
//     grants a verified token email in the server-side allowlist; token role
//     claims and database rows never grant administrator access. The wrapper
//     re-checks the same allowlist on every staff request, so removal takes
//     effect on the next call. Nothing here reads a role, a user id, an email
//     or an admin flag from a request body, query string or header.
//     Administrators inherit every moderator permission, plus suspension.
//
//   - **Moderators come from the database row.** A verified caller whose email
//     is not allowlisted but whose own `public.user_roles` row says moderator
//     reaches staff reads and moderation writes — never suspension, which is
//     refused at the router tier, the wrapper tier and the database guard. A
//     stale administrator row for an email outside the allowlist grants
//     nothing, and the session reports it as a plain user.
//
//   - **Allowlisted administrators without a row are served privileged.** When
//     the deployment holds the server-only secret key, staff database calls
//     run as the service role against `*_svc` wrappers that only it may
//     execute, carrying the verified actor for attribution. Without the secret
//     the caller's own token is used and the database guards decide — an
//     allowlisted administrator without a row is then refused honestly as
//     unavailable, never as success.
//
//   - **Every number is measured.** Counts come from persisted rows; a value that
//     cannot be computed is `null` rather than zero; a screen with no data behind
//     it is either absent or answers honestly that it is unavailable. Nothing is
//     estimated, and nothing is filled in from a fixture.
//
//   - **A moderation action and its audit are one transaction.** Publishing a
//     game, resolving a report, hiding a comment and suspending an account all go
//     through a database function that writes the decision and the
//     `moderation_actions` row together, stamping the actor from the token.
//
// The public path stays `/api/v1/admin/...`; the gateway routes the group and
// every route below requires a token before it can be reached at all.
package admin

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/adminallowlist"
	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
	"github.com/r1jadi/unbored/services/internal/apiroutes"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

// Name is the service name used in logs, configuration validation and the
// SERVICE_NAME default.
const Name = "admin"

// The routes this service publishes. They are constants so the contract, the
// tests, the gateway's route table and the README cannot drift from the router.
const (
	// SessionPath reads the caller's own role and account state. It is the one
	// admin route an ordinary signed-in user may call, because knowing you are
	// not an administrator is not privileged information — and without it the
	// only possible answer to "may I open this?" would be a 403.
	SessionPath = "/api/v1/admin/session"
	// OverviewPath is the dashboard aggregate.
	OverviewPath = "/api/v1/admin/overview"
	// AnalyticsPath is the wider activity aggregate.
	AnalyticsPath = "/api/v1/admin/analytics"
	// GamesPath lists every game, published or not, and PATCH decides one.
	GamesPath      = "/api/v1/admin/games"
	GamePath       = "/api/v1/admin/games/{gameID}"
	CategoriesPath = "/api/v1/admin/categories"
	// ReportsPath is the moderation queue; PATCH moves one report.
	ReportsPath = "/api/v1/admin/reports"
	ReportPath  = "/api/v1/admin/reports/{reportID}"
	// CommentsPath lists comments including hidden ones; PATCH hides or restores.
	CommentsPath = "/api/v1/admin/comments"
	CommentPath  = "/api/v1/admin/comments/{commentID}"
	// UsersPath is the account directory; PATCH suspends or restores (admin only).
	UsersPath = "/api/v1/admin/users"
	UserPath  = "/api/v1/admin/users/{userID}"
	// LeaderboardsPath lists verified scores with the run behind each one.
	LeaderboardsPath = "/api/v1/admin/leaderboards"
	// ModerationLogPath is the audit trail of staff decisions.
	ModerationLogPath = "/api/v1/admin/moderation-log"
	// FeedbackPath lists messages submitted from Settings → Send feedback.
	FeedbackPath = "/api/v1/admin/feedback"
	// SystemServicesPath reports the platform's service list. It answers what
	// exists, not what is healthy: this deployment collects no metrics.
	SystemServicesPath = "/api/v1/admin/system/services"
)

// Paging bounds, mirroring the database functions.
const (
	defaultPageLimit = 50
	maxPageLimit     = 100
	// maxReasonRunes matches the `moderation_actions.reason` constraint. A longer
	// reason is refused here so the caller is told which field is wrong instead of
	// reading a constraint failure.
	maxReasonRunes = 500
	// maxSearchRunes bounds a filter box.
	maxSearchRunes = 100
)

// The status values each write accepts, mirroring the database enums.
var (
	gameStatuses   = []string{"draft", "review", "published", "rejected", "archived"}
	reportStatuses = []string{"open", "reviewing", "resolved", "dismissed"}
	appRoles       = []string{"user", "moderator", "admin"}
	commentStates  = []string{"all", "visible", "hidden"}
)

// uuidPattern matches the path identifiers the API accepts, and slugPattern the
// game slugs a score filter may name. They are checked before the database so a
// malformed value is a 400 that names the field instead of a query that finds
// nothing.
var (
	uuidPattern = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	slugPattern = regexp.MustCompile(`^[a-z0-9-]{2,48}$`)
)

// Backend is the database surface this service needs. It is an interface so the
// handlers are tested without a network, and so a deployment that has not been
// given Supabase credentials can still boot, serve its probes and answer 503 on
// the admin routes instead of crash-looping.
//
// Every staff method takes the verified actor (the user id from the verified
// token, after the service's authorization check — never client input) alongside
// the caller's token. The privileged client sends the actor as `p_actor` on its
// service-role call; the caller-token client ignores it and lets the database
// guards decide.
type Backend interface {
	Identity(ctx context.Context, token string) (supabaseadmin.Identity, error)
	Overview(ctx context.Context, token, actor string) (supabaseadmin.Overview, error)
	Analytics(ctx context.Context, token, actor string, days int) (supabaseadmin.Analytics, error)
	Games(ctx context.Context, token, actor, status, search string, page supabaseadmin.Page) ([]supabaseadmin.Game, error)
	Users(ctx context.Context, token, actor, search, role string, page supabaseadmin.Page) ([]supabaseadmin.User, error)
	Reports(ctx context.Context, token, actor, status string, page supabaseadmin.Page) ([]supabaseadmin.Report, error)
	Comments(ctx context.Context, token, actor, state, search string, page supabaseadmin.Page) ([]supabaseadmin.Comment, error)
	Scores(ctx context.Context, token, actor, gameSlug, username string, page supabaseadmin.Page) ([]supabaseadmin.Score, error)
	Feedback(ctx context.Context, token, actor, category, search string, page supabaseadmin.Page) ([]supabaseadmin.Feedback, error)
	Categories(ctx context.Context, token, actor string) ([]supabaseadmin.Category, error)
	ModerationLog(ctx context.Context, token, actor string, page supabaseadmin.Page) ([]supabaseadmin.ModerationAction, error)
	SetGameStatus(ctx context.Context, token, actor, gameID, status, reason string) (supabaseadmin.ActionResult, error)
	SetReportStatus(ctx context.Context, token, actor, reportID, status, reason string) (supabaseadmin.ActionResult, error)
	SetCommentHidden(ctx context.Context, token, actor, commentID string, hidden bool, reason string) (supabaseadmin.ActionResult, error)
	SetSuspension(ctx context.Context, token, actor, userID string, suspended bool, reason string) (supabaseadmin.ActionResult, error)
}

// staffTier is what a staff request was authorized as: an allowlisted
// administrator (full access, including suspension) or a database moderator
// (staff reads and moderation writes, never suspension).
type staffTier string

const (
	tierAdmin     staffTier = "admin"
	tierModerator staffTier = "moderator"
)

type tierKey int

const staffTierKey tierKey = 1

// withTier stores the authorization tier on a request context.
func withTier(ctx context.Context, tier staffTier) context.Context {
	return context.WithValue(ctx, staffTierKey, tier)
}

// tierFromContext returns the authorization tier stored by the staff wrapper.
func tierFromContext(ctx context.Context) (staffTier, bool) {
	tier, ok := ctx.Value(staffTierKey).(staffTier)
	return tier, ok
}

// ── Response shapes ─────────────────────────────────────────────────────────
//
// Responses are assembled field by field rather than by re-encoding a database
// row, so a column added later cannot appear in an admin response by accident.
// Optional fields are pointers without `omitempty`: they are always present, and
// `null` means "there is none" rather than "not sent".

type sessionView struct {
	UserID      string `json:"userId"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
	IsStaff     bool   `json:"isStaff"`
	IsAdmin     bool   `json:"isAdmin"`
	IsSuspended bool   `json:"isSuspended"`
}

type seriesPointView struct {
	Day     string `json:"day"`
	Runs    int64  `json:"runs"`
	Scores  int64  `json:"scores"`
	Signups int64  `json:"signups"`
	Players int64  `json:"players"`
}

type activityView struct {
	Kind        string    `json:"kind"`
	At          time.Time `json:"at"`
	Actor       string    `json:"actor"`
	Action      string    `json:"action"`
	SubjectKind string    `json:"subjectKind"`
	Subject     string    `json:"subject"`
	Href        *string   `json:"href"`
}

type topGameView struct {
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Runs  int64  `json:"runs"`
}

type overviewView struct {
	TotalUsers       int64 `json:"totalUsers"`
	ActiveUsers      int64 `json:"activeUsers"`
	Games            int64 `json:"games"`
	PublishedGames   int64 `json:"publishedGames"`
	PlayableGames    int64 `json:"playableGames"`
	GamesPlayed      int64 `json:"gamesPlayed"`
	RunsOpen         int64 `json:"runsOpen"`
	ScoresRecorded   int64 `json:"scoresRecorded"`
	Players          int64 `json:"players"`
	OpenReports      int64 `json:"openReports"`
	PendingReview    int64 `json:"pendingReview"`
	ReviewingReports int64 `json:"reviewingReports"`
	Comments         int64 `json:"comments"`
	HiddenComments   int64 `json:"hiddenComments"`
	NewUsersToday    int64 `json:"newUsersToday"`
	// AvgRunSeconds is null until a run has been completed: an unmeasured average
	// and a zero-second average are different claims.
	AvgRunSeconds *float64          `json:"avgRunSeconds"`
	RunsMeasured  int64             `json:"runsMeasured"`
	Series        []seriesPointView `json:"series"`
	Activity      []activityView    `json:"activity"`
	TopGames      []topGameView     `json:"topGames"`
}

type analyticsGameView struct {
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	Runs      int64  `json:"runs"`
	Players   int64  `json:"players"`
	BestScore int64  `json:"bestScore"`
}

type topPlayerView struct {
	Username     string     `json:"username"`
	BestScore    int64      `json:"bestScore"`
	Scores       int64      `json:"scores"`
	LastScoredAt *time.Time `json:"lastScoredAt"`
}

type analyticsView struct {
	Days          int64               `json:"days"`
	TotalUsers    int64               `json:"totalUsers"`
	NewUsers      int64               `json:"newUsers"`
	Runs          int64               `json:"runs"`
	Players       int64               `json:"players"`
	Scores        int64               `json:"scores"`
	Comments      int64               `json:"comments"`
	AvgRunSeconds *float64            `json:"avgRunSeconds"`
	Series        []seriesPointView   `json:"series"`
	TopGames      []analyticsGameView `json:"topGames"`
	TopPlayers    []topPlayerView     `json:"topPlayers"`
}

type gameView struct {
	ID            string     `json:"id"`
	Slug          string     `json:"slug"`
	Title         string     `json:"title"`
	Tagline       *string    `json:"tagline"`
	Status        string     `json:"status"`
	IsOfficial    bool       `json:"isOfficial"`
	Playable      bool       `json:"playable"`
	Runtime       *string    `json:"runtime"`
	CategorySlug  *string    `json:"categorySlug"`
	CategoryName  *string    `json:"categoryName"`
	OwnerUsername *string    `json:"ownerUsername"`
	Plays         int64      `json:"plays"`
	Players       int64      `json:"players"`
	BestScore     *int64     `json:"bestScore"`
	Comments      int64      `json:"comments"`
	CreatedAt     time.Time  `json:"createdAt"`
	PublishedAt   *time.Time `json:"publishedAt"`
	UpdatedAt     time.Time  `json:"updatedAt"`
}

type userView struct {
	ID             string     `json:"id"`
	Username       string     `json:"username"`
	DisplayName    string     `json:"displayName"`
	Email          *string    `json:"email"`
	Role           string     `json:"role"`
	IsSuspended    bool       `json:"isSuspended"`
	CreatedAt      time.Time  `json:"createdAt"`
	LastActiveAt   *time.Time `json:"lastActiveAt"`
	Plays          int64      `json:"plays"`
	BestScore      *int64     `json:"bestScore"`
	ReportsAgainst int64      `json:"reportsAgainst"`
}

type reportView struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	TargetKind         string     `json:"targetKind"`
	TargetID           string     `json:"targetId"`
	TargetLabel        *string    `json:"targetLabel"`
	TargetDetail       *string    `json:"targetDetail"`
	Reason             string     `json:"reason"`
	Details            *string    `json:"details"`
	ReporterUsername   string     `json:"reporterUsername"`
	ResolvedByUsername *string    `json:"resolvedByUsername"`
	CreatedAt          time.Time  `json:"createdAt"`
	ResolvedAt         *time.Time `json:"resolvedAt"`
}

type commentView struct {
	ID             string    `json:"id"`
	Body           string    `json:"body"`
	AuthorUsername string    `json:"authorUsername"`
	GameSlug       string    `json:"gameSlug"`
	GameTitle      string    `json:"gameTitle"`
	IsHidden       bool      `json:"isHidden"`
	IsReply        bool      `json:"isReply"`
	Likes          int64     `json:"likes"`
	Reports        int64     `json:"reports"`
	CreatedAt      time.Time `json:"createdAt"`
}

type scoreView struct {
	ID             string     `json:"id"`
	GameSlug       string     `json:"gameSlug"`
	GameTitle      string     `json:"gameTitle"`
	Username       string     `json:"username"`
	Score          int64      `json:"score"`
	SessionStarted *time.Time `json:"sessionStartedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type feedbackView struct {
	ID             string     `json:"id"`
	Mood           int        `json:"mood"`
	Category       string     `json:"category"`
	Message        string     `json:"message"`
	Context        *string    `json:"context"`
	SenderUsername string     `json:"senderUsername"`
	EmailedAt      *time.Time `json:"emailedAt"`
	CreatedAt      time.Time  `json:"createdAt"`
}

type categoryView struct {
	Slug           string  `json:"slug"`
	Name           string  `json:"name"`
	Description    *string `json:"description"`
	SortOrder      int     `json:"sortOrder"`
	PublishedGames int64   `json:"publishedGames"`
	TotalGames     int64   `json:"totalGames"`
}

type moderationActionView struct {
	ID                string    `json:"id"`
	ModeratorUsername string    `json:"moderatorUsername"`
	TargetKind        string    `json:"targetKind"`
	TargetID          string    `json:"targetId"`
	Action            string    `json:"action"`
	Reason            *string   `json:"reason"`
	CreatedAt         time.Time `json:"createdAt"`
}

// actionView is what a moderation write answers with.
type actionView struct {
	ID             string  `json:"id"`
	PreviousStatus *string `json:"previousStatus"`
	Status         *string `json:"status"`
	Hidden         *bool   `json:"hidden"`
	Suspended      *bool   `json:"suspended"`
	Action         string  `json:"action"`
}

// serviceView is one platform service as this deployment can honestly describe
// it: it exists, and its health is not measured here.
type serviceView struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	Note   string `json:"note"`
}

// ── Handlers ────────────────────────────────────────────────────────────────

type service struct {
	backend Backend
	logger  *slog.Logger
	// services is the platform's service list, injected so the handler is testable
	// and so it cannot drift from the gateway's routing table.
	services []string
	// maxBody bounds a moderation request body, from the resolved configuration.
	maxBody int64
}

func newService(backend Backend, logger *slog.Logger, services []string, maxBody int64) *service {
	if logger == nil {
		logger = slog.Default()
	}
	if maxBody <= 0 {
		maxBody = 1 << 20
	}
	return &service{backend: backend, logger: logger, services: services, maxBody: maxBody}
}

// register mounts the routes.
//
// The tiers are the platform's: `AuthenticatedFunc` for the session endpoint
// and for the staff routes below, `AdminFunc` for the suspension route. The
// staff wrapper authorizes every staff request after authentication —
// allowlisted verified emails as administrators, database moderator rows as
// moderators — and database rows never grant administrator access.
func (s *service) register(router *httpx.Router) {
	router.AuthenticatedFunc("GET "+SessionPath, s.session)

	router.AuthenticatedFunc("GET "+OverviewPath, s.staff(s.overview))
	router.AuthenticatedFunc("GET "+AnalyticsPath, s.staff(s.analytics))
	router.AuthenticatedFunc("GET "+GamesPath, s.staff(s.listGames))
	router.AuthenticatedFunc("PATCH "+GamePath, s.staff(s.moderateGame))
	router.AuthenticatedFunc("GET "+CategoriesPath, s.staff(s.listCategories))
	router.AuthenticatedFunc("GET "+ReportsPath, s.staff(s.listReports))
	router.AuthenticatedFunc("PATCH "+ReportPath, s.staff(s.moderateReport))
	router.AuthenticatedFunc("GET "+CommentsPath, s.staff(s.listComments))
	router.AuthenticatedFunc("PATCH "+CommentPath, s.staff(s.moderateComment))
	router.AuthenticatedFunc("GET "+UsersPath, s.staff(s.listUsers))
	router.AuthenticatedFunc("GET "+LeaderboardsPath, s.staff(s.listScores))
	router.AuthenticatedFunc("GET "+FeedbackPath, s.staff(s.listFeedback))
	router.AuthenticatedFunc("GET "+ModerationLogPath, s.staff(s.listModeration))
	router.AuthenticatedFunc("GET "+SystemServicesPath, s.staff(s.systemServices))

	// Suspension is the one action that changes whether a person can use the
	// platform at all, so it stays on the admin tier: the allowlist alone
	// admits, and the handler re-checks the tier before the database is
	// touched. A database moderator row — however stale — never reaches it.
	router.AdminFunc("PATCH "+UserPath, s.staff(s.suspendUser))
}

// staff authorizes every staff request, after the router verified the token.
//
//   - A verified email in the server-side ADMIN_EMAILS allowlist is an
//     administrator: full access, no claim or database row required, and
//     removal takes effect on the next request.
//   - Otherwise the service reads the caller's own role row (as the caller,
//     via the backend): a moderator row grants the moderator tier — staff
//     reads and moderation writes, never suspension. An administrator row for
//     an email outside the allowlist grants nothing: rows never promote.
//   - Anything else is refused with 403 before the database is touched for
//     staff work.
//
// The tier travels on the request context so handlers that need it
// (suspension) can re-check without trusting the request.
func (s *service) staff(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token := authn.BearerToken(r.Header.Get("Authorization"))
		if token == "" {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Sign in to continue."))
			return
		}

		// The verified identity only: set by the middleware from the Supabase
		// JWT after signature verification. Never a body, query or header value.
		var verified identity.Identity
		if id, ok := identity.FromContext(r.Context()); ok && !id.Anonymous {
			verified = id
		}
		if adminallowlist.IsAllowlisted(verified.Email) {
			if s.backend == nil {
				s.notConfigured(w, r, "serve the admin API")
				return
			}
			next.ServeHTTP(w, r.WithContext(withTier(r.Context(), tierAdmin)))
			return
		}

		if s.backend == nil {
			s.notConfigured(w, r, "serve the admin API")
			return
		}
		who, err := s.backend.Identity(r.Context(), token)
		if err != nil {
			s.identityFailure(w, r, err)
			return
		}
		if !who.IsStaff || who.IsAdmin {
			// Not staff at all — or a stale administrator row for an email the
			// allowlist does not contain, which must never promote. Either way
			// the caller learns only that they are not staff.
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeForbidden,
				"This area requires a moderator account."))
			return
		}

		next.ServeHTTP(w, r.WithContext(withTier(r.Context(), tierModerator)))
	}
}

// session answers who the caller is. It is the only route in this group an
// ordinary user may call, and it is how the app decides whether to show the
// dashboard at all — a decision enforced here, never only in the UI.
//
// The administrator fields come from the allowlist first: an allowlisted
// verified email is reported as an administrator (role admin, staff and admin
// true) with no claim or row required. Otherwise the caller's own database row
// decides between moderator and user — and a stale administrator row for an
// email outside the allowlist is still reported as a non-admin user, because
// rows never promote. The username, display name and suspension state are the
// caller's own profile row (not a privilege); the allowlist itself is never
// sent.
func (s *service) session(w http.ResponseWriter, r *http.Request) {
	id, ok := identity.FromContext(r.Context())
	if !ok || id.Anonymous {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Sign in to continue."))
		return
	}
	if s.backend == nil {
		s.notConfigured(w, r, "read your profile")
		return
	}

	token := authn.BearerToken(r.Header.Get("Authorization"))
	who, err := s.backend.Identity(r.Context(), token)
	if err != nil {
		s.identityFailure(w, r, err)
		return
	}

	role := identity.RoleUser
	isStaff, isAdmin := false, false
	switch {
	case adminallowlist.IsAllowlisted(id.Email):
		role, isStaff, isAdmin = identity.RoleAdmin, true, true
	case who.IsStaff && !who.IsAdmin:
		role, isStaff = identity.RoleModerator, true
	}

	httpx.WriteJSON(w, r, http.StatusOK, sessionView{
		UserID:      id.UserID,
		Username:    who.Username,
		DisplayName: who.DisplayName,
		Role:        role,
		IsStaff:     isStaff,
		IsAdmin:     isAdmin,
		IsSuspended: who.IsSuspended,
	})
}

func (s *service) overview(w http.ResponseWriter, r *http.Request) {
	token := s.token(r)
	overview, err := s.backend.Overview(r.Context(), token, s.actor(r))
	if err != nil {
		s.dataFailure(w, r, "read the overview", err)
		return
	}

	series := make([]seriesPointView, 0, len(overview.Series))
	for _, point := range overview.Series {
		series = append(series, seriesPointView{
			Day:     point.Day,
			Runs:    point.Runs,
			Scores:  point.Scores,
			Signups: point.Signups,
			Players: point.Players,
		})
	}

	activity := make([]activityView, 0, len(overview.Activity))
	for _, line := range overview.Activity {
		activity = append(activity, activityView{
			Kind:        line.Kind,
			At:          line.At,
			Actor:       line.Actor,
			Action:      line.Action,
			SubjectKind: line.SubjectKind,
			Subject:     line.Subject,
			Href:        line.Href,
		})
	}

	top := make([]topGameView, 0, len(overview.TopGames))
	for _, game := range overview.TopGames {
		top = append(top, topGameView{Slug: game.Slug, Title: game.Title, Runs: game.Runs})
	}

	httpx.WriteJSON(w, r, http.StatusOK, overviewView{
		TotalUsers:       overview.TotalUsers,
		ActiveUsers:      overview.ActiveUsers,
		Games:            overview.Games,
		PublishedGames:   overview.PublishedGames,
		PlayableGames:    overview.PlayableGames,
		GamesPlayed:      overview.GamesPlayed,
		RunsOpen:         overview.RunsOpen,
		ScoresRecorded:   overview.ScoresRecorded,
		Players:          overview.Players,
		OpenReports:      overview.OpenReports,
		PendingReview:    overview.PendingReview,
		ReviewingReports: overview.ReviewingReports,
		Comments:         overview.Comments,
		HiddenComments:   overview.HiddenComments,
		NewUsersToday:    overview.NewUsersToday,
		AvgRunSeconds:    overview.AvgRunSeconds,
		RunsMeasured:     overview.RunsMeasured,
		Series:           series,
		Activity:         activity,
		TopGames:         top,
	})
}

func (s *service) analytics(w http.ResponseWriter, r *http.Request) {
	days := 28
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 7 || value > 90 {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				"days must be a whole number between 7 and 90.",
				apierr.Detail{Field: "days", Rule: "range"}))
			return
		}
		days = value
	}

	analytics, err := s.backend.Analytics(r.Context(), s.token(r), s.actor(r), days)
	if err != nil {
		s.dataFailure(w, r, "read analytics", err)
		return
	}

	series := make([]seriesPointView, 0, len(analytics.Series))
	for _, point := range analytics.Series {
		series = append(series, seriesPointView{
			Day:     point.Day,
			Runs:    point.Runs,
			Scores:  point.Scores,
			Signups: point.Signups,
			Players: point.Players,
		})
	}

	games := make([]analyticsGameView, 0, len(analytics.TopGames))
	for _, game := range analytics.TopGames {
		games = append(games, analyticsGameView{
			Slug:      game.Slug,
			Title:     game.Title,
			Runs:      game.Runs,
			Players:   game.Players,
			BestScore: game.BestScore,
		})
	}

	players := make([]topPlayerView, 0, len(analytics.TopPlayers))
	for _, player := range analytics.TopPlayers {
		players = append(players, topPlayerView{
			Username:     player.Username,
			BestScore:    player.BestScore,
			Scores:       player.Scores,
			LastScoredAt: player.LastScoredAt,
		})
	}

	httpx.WriteJSON(w, r, http.StatusOK, analyticsView{
		Days:          analytics.Days,
		TotalUsers:    analytics.TotalUsers,
		NewUsers:      analytics.NewUsers,
		Runs:          analytics.Runs,
		Players:       analytics.Players,
		Scores:        analytics.Scores,
		Comments:      analytics.Comments,
		AvgRunSeconds: analytics.AvgRunSeconds,
		Series:        series,
		TopGames:      games,
		TopPlayers:    players,
	})
}

func (s *service) listGames(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !contains(gameStatuses, status) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a game status.",
			apierr.Detail{Field: "status", Rule: "unsupported"}))
		return
	}
	search, ok := s.search(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.Games(r.Context(), s.token(r), s.actor(r), status, search, page)
	if err != nil {
		s.dataFailure(w, r, "list games", err)
		return
	}

	items := make([]gameView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, gameView{
			ID:            row.ID,
			Slug:          row.Slug,
			Title:         row.Title,
			Tagline:       row.Tagline,
			Status:        row.Status,
			IsOfficial:    row.IsOfficial,
			Playable:      row.Playable,
			Runtime:       row.Runtime,
			CategorySlug:  row.CategorySlug,
			CategoryName:  row.CategoryName,
			OwnerUsername: row.OwnerUsername,
			Plays:         row.Plays,
			Players:       row.Players,
			BestScore:     row.BestScore,
			Comments:      row.Comments,
			CreatedAt:     row.CreatedAt,
			PublishedAt:   row.PublishedAt,
			UpdatedAt:     row.UpdatedAt,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listUsers(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if role != "" && !contains(appRoles, role) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not an account role.",
			apierr.Detail{Field: "role", Rule: "unsupported"}))
		return
	}
	search, ok := s.search(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.Users(r.Context(), s.token(r), s.actor(r), search, role, page)
	if err != nil {
		s.dataFailure(w, r, "list accounts", err)
		return
	}

	items := make([]userView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, userView{
			ID:             row.ID,
			Username:       row.Username,
			DisplayName:    row.DisplayName,
			Email:          row.Email,
			Role:           row.Role,
			IsSuspended:    row.IsSuspended,
			CreatedAt:      row.CreatedAt,
			LastActiveAt:   row.LastActiveAt,
			Plays:          row.Plays,
			BestScore:      row.BestScore,
			ReportsAgainst: row.ReportsAgainst,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listReports(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !contains(reportStatuses, status) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a report status.",
			apierr.Detail{Field: "status", Rule: "unsupported"}))
		return
	}

	rows, err := s.backend.Reports(r.Context(), s.token(r), s.actor(r), status, page)
	if err != nil {
		s.dataFailure(w, r, "list reports", err)
		return
	}

	items := make([]reportView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, reportView{
			ID:                 row.ID,
			Status:             row.Status,
			TargetKind:         row.TargetKind,
			TargetID:           row.TargetID,
			TargetLabel:        row.TargetLabel,
			TargetDetail:       row.TargetDetail,
			Reason:             row.Reason,
			Details:            row.Details,
			ReporterUsername:   row.ReporterUsername,
			ResolvedByUsername: row.ResolvedByUsername,
			CreatedAt:          row.CreatedAt,
			ResolvedAt:         row.ResolvedAt,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listComments(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	state := strings.TrimSpace(r.URL.Query().Get("state"))
	if state != "" && !contains(commentStates, state) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"state must be one of all, visible or hidden.",
			apierr.Detail{Field: "state", Rule: "unsupported"}))
		return
	}
	if state == "all" {
		state = ""
	}
	search, ok := s.search(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.Comments(r.Context(), s.token(r), s.actor(r), state, search, page)
	if err != nil {
		s.dataFailure(w, r, "list comments", err)
		return
	}

	items := make([]commentView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, commentView{
			ID:             row.ID,
			Body:           row.Body,
			AuthorUsername: row.AuthorUsername,
			GameSlug:       row.GameSlug,
			GameTitle:      row.GameTitle,
			IsHidden:       row.IsHidden,
			IsReply:        row.IsReply,
			Likes:          row.Likes,
			Reports:        row.Reports,
			CreatedAt:      row.CreatedAt,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listScores(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	gameSlug := strings.TrimSpace(r.URL.Query().Get("game"))
	if gameSlug != "" && !slugPattern.MatchString(gameSlug) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid game slug.",
			apierr.Detail{Field: "game", Rule: "format"}))
		return
	}
	username, ok := s.search(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.Scores(r.Context(), s.token(r), s.actor(r), gameSlug, username, page)
	if err != nil {
		s.dataFailure(w, r, "list scores", err)
		return
	}

	items := make([]scoreView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, scoreView{
			ID:             row.ID,
			GameSlug:       row.GameSlug,
			GameTitle:      row.GameTitle,
			Username:       row.Username,
			Score:          row.Score,
			SessionStarted: row.SessionStarted,
			CreatedAt:      row.CreatedAt,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listFeedback(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	category := strings.TrimSpace(r.URL.Query().Get("category"))
	if category != "" && !contains([]string{"idea", "bug", "praise", "other"}, category) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a feedback category.",
			apierr.Detail{Field: "category", Rule: "unsupported"}))
		return
	}
	search, ok := s.search(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.Feedback(r.Context(), s.token(r), s.actor(r), category, search, page)
	if err != nil {
		s.dataFailure(w, r, "list feedback", err)
		return
	}

	items := make([]feedbackView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, feedbackView{
			ID:             row.ID,
			Mood:           row.Mood,
			Category:       row.Category,
			Message:        row.Message,
			Context:        row.Context,
			SenderUsername: row.SenderUsername,
			EmailedAt:      row.EmailedAt,
			CreatedAt:      row.CreatedAt,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

func (s *service) listCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := s.backend.Categories(r.Context(), s.token(r), s.actor(r))
	if err != nil {
		s.dataFailure(w, r, "list categories", err)
		return
	}

	items := make([]categoryView, 0, len(rows))
	for _, row := range rows {
		items = append(items, categoryView{
			Slug:           row.Slug,
			Name:           row.Name,
			Description:    row.Description,
			SortOrder:      row.SortOrder,
			PublishedGames: row.PublishedGames,
			TotalGames:     row.TotalGames,
		})
	}

	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Items []categoryView `json:"items"`
	}{Items: items})
}

func (s *service) listModeration(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}

	rows, err := s.backend.ModerationLog(r.Context(), s.token(r), s.actor(r), page)
	if err != nil {
		s.dataFailure(w, r, "read the moderation log", err)
		return
	}

	items := make([]moderationActionView, 0, min(len(rows), page.Limit))
	for _, row := range rows[:min(len(rows), page.Limit)] {
		items = append(items, moderationActionView{
			ID:                row.ID,
			ModeratorUsername: row.ModeratorUsername,
			TargetKind:        row.TargetKind,
			TargetID:          row.TargetID,
			Action:            row.Action,
			Reason:            row.Reason,
			CreatedAt:         row.CreatedAt,
		})
	}

	s.writePage(w, r, items, len(rows) > page.Limit)
}

// systemServices reports which services the platform is made of. It does not
// report health: nothing in this deployment collects uptime or latency, and an
// invented number here would be indistinguishable from a measured one. Every
// entry is therefore `unmeasured`, with the reason stated once.
func (s *service) systemServices(w http.ResponseWriter, r *http.Request) {
	items := make([]serviceView, 0, len(s.services))
	for _, name := range s.services {
		items = append(items, serviceView{
			Name:   name,
			Status: "unmeasured",
			Note:   "This deployment collects no service metrics.",
		})
	}

	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Measured bool          `json:"measured"`
		Note     string        `json:"note"`
		Items    []serviceView `json:"items"`
	}{
		Measured: false,
		Note: "Service health is not measured by this deployment. " +
			"The list below is the platform's routing table: it says which services exist, not whether they are healthy.",
		Items: items,
	})
}

// ── Moderation writes ───────────────────────────────────────────────────────

type moderateGameRequest struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

func (s *service) moderateGame(w http.ResponseWriter, r *http.Request) {
	gameID, ok := s.pathID(w, r, "gameID", "game")
	if !ok {
		return
	}

	var body moderateGameRequest
	if !s.decode(w, r, &body) {
		return
	}
	status := strings.TrimSpace(body.Status)
	if !contains(gameStatuses, status) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"status must be one of draft, review, published, rejected or archived.",
			apierr.Detail{Field: "status", Rule: "unsupported"}))
		return
	}
	if !s.reason(w, r, body.Reason) {
		return
	}

	result, err := s.backend.SetGameStatus(r.Context(), s.token(r), s.actor(r), gameID, status, body.Reason)
	if err != nil {
		s.moderationFailure(w, r, "moderate a game", err)
		return
	}

	httpx.WriteJSON(w, r, http.StatusOK, actionView{
		ID:             result.GameID,
		PreviousStatus: result.PreviousStatus,
		Status:         result.Status,
		Action:         result.Action,
	})
}

type moderateReportRequest struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

func (s *service) moderateReport(w http.ResponseWriter, r *http.Request) {
	reportID, ok := s.pathID(w, r, "reportID", "report")
	if !ok {
		return
	}

	var body moderateReportRequest
	if !s.decode(w, r, &body) {
		return
	}
	status := strings.TrimSpace(body.Status)
	if !contains(reportStatuses, status) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"status must be one of open, reviewing, resolved or dismissed.",
			apierr.Detail{Field: "status", Rule: "unsupported"}))
		return
	}
	if !s.reason(w, r, body.Reason) {
		return
	}

	result, err := s.backend.SetReportStatus(r.Context(), s.token(r), s.actor(r), reportID, status, body.Reason)
	if err != nil {
		s.moderationFailure(w, r, "moderate a report", err)
		return
	}

	httpx.WriteJSON(w, r, http.StatusOK, actionView{
		ID:             result.ReportID,
		PreviousStatus: result.PreviousStatus,
		Status:         result.Status,
		Action:         result.Action,
	})
}

type moderateCommentRequest struct {
	Hidden *bool  `json:"hidden"`
	Reason string `json:"reason"`
}

func (s *service) moderateComment(w http.ResponseWriter, r *http.Request) {
	commentID, ok := s.pathID(w, r, "commentID", "comment")
	if !ok {
		return
	}

	var body moderateCommentRequest
	if !s.decode(w, r, &body) {
		return
	}
	if body.Hidden == nil {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"hidden is required: true hides the comment, false restores it.",
			apierr.Detail{Field: "hidden", Rule: "required"}))
		return
	}
	if !s.reason(w, r, body.Reason) {
		return
	}

	result, err := s.backend.SetCommentHidden(r.Context(), s.token(r), s.actor(r), commentID, *body.Hidden, body.Reason)
	if err != nil {
		s.moderationFailure(w, r, "moderate a comment", err)
		return
	}

	httpx.WriteJSON(w, r, http.StatusOK, actionView{
		ID:     result.CommentID,
		Hidden: result.Hidden,
		Action: result.Action,
	})
}

type suspendUserRequest struct {
	Suspended *bool  `json:"suspended"`
	Reason    string `json:"reason"`
}

// suspendUser suspends or restores an account. Suspension is administrator-only:
// the router's admin tier admits allowlisted emails, and the tier re-check below
// refuses anything else — including a database moderator row — before the
// database is touched. The database function re-checks the role a third time.
func (s *service) suspendUser(w http.ResponseWriter, r *http.Request) {
	if tier, _ := tierFromContext(r.Context()); tier != tierAdmin {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeForbidden,
			"This action requires an administrator account."))
		return
	}

	userID, ok := s.pathID(w, r, "userID", "account")
	if !ok {
		return
	}

	var body suspendUserRequest
	if !s.decode(w, r, &body) {
		return
	}
	if body.Suspended == nil {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"suspended is required: true suspends the account, false restores it.",
			apierr.Detail{Field: "suspended", Rule: "required"}))
		return
	}
	if !s.reason(w, r, body.Reason) {
		return
	}

	result, err := s.backend.SetSuspension(r.Context(), s.token(r), s.actor(r), userID, *body.Suspended, body.Reason)
	if err != nil {
		s.moderationFailure(w, r, "suspend an account", err)
		return
	}

	httpx.WriteJSON(w, r, http.StatusOK, actionView{
		ID:        result.UserID,
		Suspended: result.Suspended,
		Action:    result.Action,
	})
}

// ── Query and body parsing ──────────────────────────────────────────────────

// page reads the paging parameters, writing a 400 when they are malformed.
func (s *service) page(w http.ResponseWriter, r *http.Request) (supabaseadmin.Page, bool) {
	page, err := supabaseadmin.ParsePage(r.URL.Query())
	if err != nil {
		field, rule := "limit", "range"
		if strings.Contains(err.Error(), "offset") {
			field, rule = "offset", "range"
		}
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest, err.Error()+".", apierr.Detail{Field: field, Rule: rule}))
		return page, false
	}
	return page, true
}

// search reads and bounds the free-text filter the directories accept.
func (s *service) search(w http.ResponseWriter, r *http.Request) (string, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("q"))
	if raw == "" {
		return "", true
	}
	if len([]rune(raw)) > maxSearchRunes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"Search terms are limited to 100 characters.",
			apierr.Detail{Field: "q", Rule: "maxLength"}))
		return "", false
	}
	// PostgREST's filter grammar is not what receives this value — the database
	// function takes it as a bound parameter — so the only job here is to keep it
	// a reasonable length and to trim it.
	return raw, true
}

// reason bounds a moderation reason. An empty reason is allowed because only
// some decisions require one, and the database decides which.
func (s *service) reason(w http.ResponseWriter, r *http.Request, raw string) bool {
	if len([]rune(raw)) > maxReasonRunes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"A reason is limited to 500 characters.",
			apierr.Detail{Field: "reason", Rule: "maxLength"}))
		return false
	}
	return true
}

// pathID reads a uuid path parameter, answering 400 for a malformed one so the
// caller can tell a typo apart from something that does not exist.
func (s *service) pathID(w http.ResponseWriter, r *http.Request, name, what string) (string, bool) {
	value := strings.TrimSpace(r.PathValue(name))
	if !uuidPattern.MatchString(value) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid "+what+" id.",
			apierr.Detail{Field: name, Rule: "format"}))
		return "", false
	}
	return value, true
}

// decode reads a strict JSON body — unknown fields rejected, size limited — and
// passes the platform's own error through, so an unknown field, a wrong content
// type and an oversized body each keep their documented answer rather than all
// becoming one generic 400.
func (s *service) decode(w http.ResponseWriter, r *http.Request, dst any) bool {
	if err := httpx.DecodeJSON(w, r, s.maxBody, dst); err != nil {
		httpx.WriteError(w, r, err)
		return false
	}
	return true
}

// writePage answers a directory page with the same shape the catalogue uses: one
// extra row read is how the service learns another page exists, without a COUNT.
func (s *service) writePage(w http.ResponseWriter, r *http.Request, items any, hasMore bool) {
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Items   any  `json:"items"`
		HasMore bool `json:"hasMore"`
	}{Items: items, HasMore: hasMore})
}

// ── Failures ────────────────────────────────────────────────────────────────

func (s *service) token(r *http.Request) string {
	return authn.BearerToken(r.Header.Get("Authorization"))
}

// actor is the verified user id the request carries: the attribution every
// privileged database call names. It comes from the verified token identity
// only — never from a body, query or header value. Empty when no verified
// identity exists, which the privileged client refuses locally (fail closed)
// rather than sending an unattributed call.
func (s *service) actor(r *http.Request) string {
	return identity.MustFromContext(r.Context()).UserID
}

// moderationFailure maps a refused moderation write onto the platform's
// envelope. The database's own text is never sent: it describes the schema.
func (s *service) moderationFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var dataErr *supabaseadmin.Error
	switch {
	case errors.As(err, &dataErr) && dataErr.IsNotFound():
		// The row being moderated is gone (or never existed). Telling the caller so
		// is right here: this is a staff-only surface, and a moderator asking about
		// a deleted report needs to know it was deleted.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound,
			"That record no longer exists."))
	case errors.As(err, &dataErr) && dataErr.IsBadRequest():
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That change is not allowed."))
	case errors.As(err, &dataErr) && dataErr.IsForbidden():
		// The database refused an already-authorized staff caller. That is a
		// deployment fault, not a privilege answer: it means the privileged
		// bridge is missing (an allowlisted administrator without a role row
		// and no secret configured) or a privileged call was refused. Telling
		// an authorized administrator they are "not staff" would be a lie, so
		// the route answers unavailable and the log records whether the
		// bridge was even available. No secret value is ever logged.
		s.logger.ErrorContext(r.Context(), "an admin write was refused by the database",
			slog.String("operation", operation),
			slog.String("code", dataErr.Code),
			slog.Bool("privileged", s.privileged()))
		s.unavailable(w, r, operation, err)
	default:
		s.dataFailure(w, r, operation, err)
	}
}

// identityFailure maps a failed identity read on the session endpoint.
func (s *service) identityFailure(w http.ResponseWriter, r *http.Request, err error) {
	var dataErr *supabaseadmin.Error
	if errors.As(err, &dataErr) && dataErr.IsUnauthorized() {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized,
			"Your session is no longer valid. Sign in again."))
		return
	}
	s.unavailable(w, r, "read your role", err)
}

// dataFailure maps a read failure onto the envelope and logs the detail.
func (s *service) dataFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var dataErr *supabaseadmin.Error
	if errors.As(err, &dataErr) && dataErr.IsForbidden() {
		// As in moderationFailure: an already-authorized staff caller refused
		// by the database is a deployment fault (a missing bridge or a
		// refused privileged call), not a privilege answer. Answer unavailable
		// and log whether the bridge was even available.
		s.logger.ErrorContext(r.Context(), "an admin read was refused by the database",
			slog.String("operation", operation),
			slog.String("code", dataErr.Code),
			slog.Bool("privileged", s.privileged()))
		s.unavailable(w, r, operation, err)
		return
	}
	s.unavailable(w, r, operation, err)
}

// privileged reports whether staff database calls run as the service role.
// It drives logging only — never authorization, which the staff wrapper
// decided before the backend was touched.
func (s *service) privileged() bool {
	priv, ok := s.backend.(interface{ Privileged() bool })
	return ok && priv.Privileged()
}

// unavailable answers a route whose database dependency failed or is missing. It
// names no variable and carries no value: the log line is where an operator finds
// out what to set.
func (s *service) unavailable(w http.ResponseWriter, r *http.Request, operation string, err error) {
	s.logger.ErrorContext(r.Context(), "admin call failed",
		slog.String("operation", operation),
		slog.Any("error", err),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
		"The admin API is not available right now."))
}

func (s *service) notConfigured(w http.ResponseWriter, r *http.Request, operation string) {
	s.logger.WarnContext(r.Context(), "admin dependency is not configured", slog.String("operation", operation))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
		"The admin API is not available right now."))
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Options returns the wiring every admin entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, _ *authn.Verifier) {
			var backend Backend
			client, err := supabaseadmin.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its probes
				// and answers 503 on the admin routes, which is far more diagnosable
				// than a crash loop. The error names the missing variables.
				logger.Warn("Supabase is not configured; the admin routes answer 503",
					slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, logger, apiroutes.Services(), cfg.HTTP.MaxRequestBytes).register(router)
		},
	}
}
