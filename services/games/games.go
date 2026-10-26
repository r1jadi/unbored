// Package games defines the Games service: the public catalogue of published
// games and their categories.
//
// What it serves, and what it deliberately does not:
//
//   - **Four public read endpoints.** `GET /api/v1/games` (a page of published
//     games, filterable by category and by a text search), `GET
//     /api/v1/games/{slug}` (one published game), `GET
//     /api/v1/games/{slug}/leaderboard` (the persisted ranking for one game, plus
//     the caller's own standing when they present a token) and `GET
//     /api/v1/categories` (every category with its real count of published
//     games). None of them requires a token: the catalogue is public, and the
//     database's RLS policies already hide everything unpublished from the
//     anonymous role.
//   - **Metrics are measured, never invented.** A game's `plays` is its number of
//     *completed* runs, counted in the database from persisted sessions, and a
//     game nobody has finished reports zero. There is still no rating, comment
//     total or average session anywhere, because no service records those, and a
//     field invented here would be indistinguishable from a real one on screen.
//   - **No "popular" or "trending" ordering yet.** Play counts now exist, but the
//     only ordering the catalogue offers is still recency: `sort` accepts exactly
//     one value, so a sort option can never make an unplayed game look busy.
//
// The slug is the public identifier (`/api/v1/games/stack-10`), matching the
// web app's stable URLs. A game's uuid is internal and never appears in a
// response.
package games

import (
	"context"
	"encoding/base64"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/services/games/internal/supabasegames"
	"github.com/r1jadi/unbored/services/internal/servicekit"
)

// Name is the service name used in logs, configuration validation and the
// SERVICE_NAME default.
const Name = "games"

// The routes this service publishes. They are constants so the contract, the
// tests, the gateway's route table and the README cannot drift from the router.
const (
	// GamesPath lists the catalogue.
	GamesPath = "/api/v1/games"
	// FollowingPath lists the caller's Following feed: published creator games
	// of followed accounts. It lives under /games so the gateway's existing
	// games binding routes it with no new upstream; it is registered before
	// GamePath but routing does not depend on order (Go's mux prefers the
	// static segment over {slug}).
	FollowingPath = "/api/v1/games/following"
	// GamePath reads one game. The identifier is the game's slug, not its uuid.
	GamePath = "/api/v1/games/{slug}"
	// LeaderboardPath reads one game's persisted ranking. It is optional-auth:
	// an anonymous caller sees the board, a signed-in one also sees their own
	// standing on it.
	LeaderboardPath = "/api/v1/games/{slug}/leaderboard"
	// OverallLeaderboardPath reads the all-games board: each player's per-game
	// percentiles, summed. Like FollowingPath it is a static segment under
	// /games, so the gateway's games binding routes it and Go's mux prefers it
	// over {slug}. Optional-auth, like a game's board.
	OverallLeaderboardPath = "/api/v1/games/leaderboard"
	// CategoriesPath lists categories with their real published-game counts.
	CategoriesPath = "/api/v1/categories"
)

const (
	defaultPageLimit = 20
	maxPageLimit     = 100
	// maxSearchRunes bounds a search box. Longer than any real query, short
	// enough that the pattern cannot become a denial-of-service.
	maxSearchRunes = 100
	// maxCursorLength matches the contract's `cursor` schema.
	maxCursorLength = 200
	// cursorPrefix versions the cursor payload, so a future change to its shape
	// can be told apart from a malformed one instead of misread as a date.
	cursorPrefix = "v1"
)

// Board paging. A board is a ranking, so a deep offset is bounded: paging
// thousands of rows into a ranking is not a use case, and an unbounded offset is
// a cheap way to make the database walk the whole board.
const (
	defaultBoardLimit = 20
	maxBoardLimit     = 100
	maxBoardOffset    = 10000
)

// The board's scope and window, as the API spells them.
const (
	// boardScopeGlobal is the only scope that can be computed. A friends board
	// needs a following graph, which does not exist yet.
	boardScopeGlobal = "global"
	periodAll        = "all"
	periodDay        = "day"
	periodWeek       = "week"
)

var (
	boardScopes  = map[string]bool{boardScopeGlobal: true}
	boardPeriods = map[string]bool{periodAll: true, periodDay: true, periodWeek: true}
)

// supportedSort is the only ordering the catalogue can compute from real data.
// `popular` and `trending` are absent on purpose: they need play counts, and no
// service records plays yet. Naming the single value (rather than dropping the
// parameter) keeps the refusal explicit and testable.
const supportedSort = "latest"

// Patterns mirror the database constraints exactly. The database stays the
// authority; these exist so a bad request is a 400 that names the field instead
// of a 500 from a constraint.
var (
	categorySlugPattern = regexp.MustCompile(`^[a-z0-9-]{2,32}$`)
	gameSlugPattern     = regexp.MustCompile(`^[a-z0-9-]{2,48}$`)
	uuidPattern         = regexp.MustCompile(`^[0-9a-f-]{36}$`)
)

// Backend is the catalogue surface this service needs. It is an interface so the
// handlers are tested without a network, and so a deployment that has not been
// given Supabase credentials can still boot, serve its probes, and answer 503 on
// the catalogue routes instead of crash-looping.
type Backend interface {
	ListGames(ctx context.Context, query supabasegames.ListQuery) ([]supabasegames.Game, error)
	// FollowingGames reads one Following-feed page for the verified follower.
	// The follower id comes from the JWT identity the handler resolved, never
	// from a request parameter.
	FollowingGames(ctx context.Context, query supabasegames.FollowingQuery) ([]supabasegames.Game, error)
	GetGame(ctx context.Context, slug string) (supabasegames.Game, bool, error)
	CategoryID(ctx context.Context, slug string) (string, bool, error)
	CategoryCounts(ctx context.Context) ([]supabasegames.CategoryCount, error)
	// GameStats reads every published game's real play count in one call; a
	// listing needs all of them. GameStat reads one.
	GameStats(ctx context.Context) (map[string]supabasegames.PlayStat, error)
	GameStat(ctx context.Context, slug string) (supabasegames.PlayStat, bool, error)
	// Leaderboard reads one page of a game's public ranking, and Standing the
	// caller's own place on it.
	Leaderboard(ctx context.Context, slug string, query supabasegames.BoardQuery) ([]supabasegames.LeaderboardEntry, error)
	Standing(ctx context.Context, slug, userID string, query supabasegames.BoardQuery) (supabasegames.Standing, bool, error)
	// OverallLeaderboard reads one page of the all-games board, and
	// OverallStanding the caller's own rating on it.
	OverallLeaderboard(ctx context.Context, query supabasegames.BoardQuery) ([]supabasegames.OverallEntry, error)
	OverallStanding(ctx context.Context, userID string, query supabasegames.BoardQuery) (supabasegames.OverallStanding, bool, error)
}

// ── Response shapes ─────────────────────────────────────────────────────────
//
// The API's view of a game is assembled field by field rather than by
// re-encoding the database row, so a column added to `games` later cannot appear
// in a response by accident — that is also why there is no `id`, `status` or
// `ownerId` here. Optional fields are pointers without `omitempty`: they are
// always present and `null` means "there is none", which a client can tell apart
// from a missing field.

type categoryView struct {
	Slug        string  `json:"slug"`
	Name        string  `json:"name"`
	Description *string `json:"description"`
	// GameCount is the real number of published games in this category.
	GameCount int64 `json:"gameCount"`
}

// categoryRefView is the trimmed category a game embeds: a slug to link by and
// a name to render. It is deliberately a different type from categoryView — a
// game response must not carry a `gameCount`, because it did not count one, and
// a zero standing in for "not measured here" reads as a real measurement.
// Counts belong to `/categories`, where they are computed in the database.
type categoryRefView struct {
	Slug string `json:"slug"`
	Name string `json:"name"`
}

type gameView struct {
	Slug         string           `json:"slug"`
	Title        string           `json:"title"`
	Tagline      *string          `json:"tagline"`
	Description  *string          `json:"description"`
	Instructions *string          `json:"instructions"`
	Category     *categoryRefView `json:"category"`
	// Runtime names the client runtime that plays this game, or null when none
	// exists.
	Runtime  *string `json:"runtime"`
	Playable bool    `json:"playable"`
	// Plays is how many runs of this game have been completed, counted in the
	// database from persisted sessions. It is always a measurement: zero means
	// nobody has finished it, which is a fact and not a missing value.
	Plays      int64 `json:"plays"`
	IsOfficial bool  `json:"isOfficial"`
	// CoverPath is a storage object path under the `game-assets` bucket, not a
	// URL: the client builds the public URL, exactly as it does for avatars.
	CoverPath   *string    `json:"coverPath"`
	PublishedAt *time.Time `json:"publishedAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

func categoryRef(category *supabasegames.Category) *categoryRefView {
	if category == nil {
		return nil
	}
	return &categoryRefView{Slug: category.Slug, Name: category.Name}
}

func view(game supabasegames.Game, plays int64) gameView {
	return gameView{
		Slug:         game.Slug,
		Title:        game.Title,
		Tagline:      game.Tagline,
		Description:  game.Description,
		Instructions: game.Instructions,
		Category:     categoryRef(game.Category),
		Runtime:      game.Runtime,
		Playable:     game.Playable,
		Plays:        plays,
		IsOfficial:   game.IsOfficial,
		CoverPath:    game.CoverPath,
		PublishedAt:  game.PublishedAt,
		UpdatedAt:    game.UpdatedAt,
	}
}

type gameListResponse struct {
	Items []gameView `json:"items"`
	// NextCursor is null on the last page. It is opaque to clients and is what
	// makes paging stable while games are published between requests.
	NextCursor *string `json:"nextCursor"`
}

// leaderboardEntryView is one row of a public board. There is no user id: a
// username is how a person is addressed everywhere else in the API, and the
// caller's own row is returned as `me` rather than by matching an id on the
// client.
type leaderboardEntryView struct {
	Rank     int64  `json:"rank"`
	Username string `json:"username"`
	Score    int64  `json:"score"`
	// AchievedAt is when the player first reached this score.
	AchievedAt *time.Time `json:"achievedAt"`
	// Plays is how many scored runs they had in this window.
	Plays int64 `json:"plays"`
}

// standingView is the caller's own place on the board they asked for.
type standingView struct {
	Rank       int64      `json:"rank"`
	Score      int64      `json:"score"`
	AchievedAt *time.Time `json:"achievedAt"`
	Plays      int64      `json:"plays"`
}

type leaderboardResponse struct {
	GameSlug string `json:"gameSlug"`
	// Scope and Period echo what was asked for, so a caller that paged through a
	// weekly board cannot mistake it for the all-time one.
	Scope   string                 `json:"scope"`
	Period  string                 `json:"period"`
	Entries []leaderboardEntryView `json:"entries"`
	// HasMore is true when a further page exists. The service learns this by
	// reading one row more than the page, not by counting the board.
	HasMore bool `json:"hasMore"`
	// Me is the signed-in caller's standing, or null when they are anonymous or
	// have no scored run in this window. A player with no score has no rank, and
	// reporting zero would read as "last place".
	Me *standingView `json:"me"`
}

// overallMinGames is how many games a player needs a percentile in before the
// all-games board ranks them. It mirrors `public.overall_leaderboard`, which is
// the authority; the response carries it so the client never hard-codes it.
const overallMinGames = 3

// overallEntryView is one row of the all-games board.
type overallEntryView struct {
	Rank     int64  `json:"rank"`
	Username string `json:"username"`
	// Rating is the sum of the player's per-game percentiles (each 1–100).
	Rating int64 `json:"rating"`
	// Games is how many games the rating covers.
	Games int64 `json:"games"`
}

// overallStandingView is the caller's own all-games rating. Rank is null while
// they are rated in fewer than MinGames games.
type overallStandingView struct {
	Rank   *int64 `json:"rank"`
	Rating int64  `json:"rating"`
	Games  int64  `json:"games"`
}

type overallLeaderboardResponse struct {
	Scope    string             `json:"scope"`
	Period   string             `json:"period"`
	MinGames int                `json:"minGames"`
	Entries  []overallEntryView `json:"entries"`
	HasMore  bool               `json:"hasMore"`
	// Me is null for an anonymous caller and for one with no scored run in this
	// window.
	Me *overallStandingView `json:"me"`
}

// ── Handlers ────────────────────────────────────────────────────────────────

// service holds the handlers' dependencies. `backend` is nil when the deployment
// has no Supabase credentials, which is a diagnosable state rather than a crash.
type service struct {
	backend Backend
	logger  *slog.Logger
}

func newService(backend Backend, logger *slog.Logger) *service {
	if logger == nil {
		logger = slog.Default()
	}
	return &service{backend: backend, logger: logger}
}

// register mounts the routes. The three catalogue reads are public; the
// not-yet-built write endpoints stay registered so the published contract and
// the router agree and a client gets a documented 501 rather than a 404.
func (s *service) register(router *httpx.Router) {
	router.PublicFunc("GET "+GamesPath, s.listGames)
	// Authenticated: the feed is scoped to the verified caller. Anonymous
	// callers are refused with 401 rather than served a public substitute.
	router.AuthenticatedFunc("GET "+FollowingPath, s.followingFeed)
	router.PublicFunc("GET "+GamePath, s.getGame)
	router.PublicFunc("GET "+CategoriesPath, s.listCategories)
	// Optional auth: the board is public, and a token only adds the caller's own
	// standing to the same response.
	router.OptionalAuthFunc("GET "+LeaderboardPath, s.leaderboard)
	router.OptionalAuthFunc("GET "+OverallLeaderboardPath, s.overallLeaderboard)

	router.AuthenticatedFunc("POST "+GamesPath, httpx.NotImplemented(Name, "Creating a game"))
	router.AuthenticatedFunc("PATCH "+GamePath, httpx.NotImplemented(Name, "Updating an owned game"))
	router.AuthenticatedFunc("POST "+GamePath+"/publish", httpx.NotImplemented(Name, "Submitting a game for review"))
}

func (s *service) listGames(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "browse the catalogue")
		return
	}

	query, failure := parseListQuery(r)
	if failure != nil {
		httpx.WriteError(w, r, failure)
		return
	}

	if query.CategorySlug != "" {
		id, found, err := s.backend.CategoryID(r.Context(), query.CategorySlug)
		if err != nil {
			s.dataFailure(w, r, "resolve a category", err)
			return
		}
		// A well-formed slug that names no category is an empty result, not an
		// error: the caller asked a valid question and the answer is "none".
		if !found {
			httpx.WriteJSON(w, r, http.StatusOK, gameListResponse{Items: []gameView{}})
			return
		}
		query.CategoryID = id
	}

	games, err := s.backend.ListGames(r.Context(), query.ListQuery)
	if err != nil {
		s.dataFailure(w, r, "list games", err)
		return
	}

	// The client fetched one row more than the page size, so a longer result is
	// exactly the signal that another page exists.
	limit := query.Limit
	items := make([]gameView, 0, min(len(games), limit))

	if len(games) > 0 {
		// One extra read for the whole page, not one per row. A failure here is
		// a failure of the listing rather than a page of games shown with a
		// play count the service could not actually read: an absent count and a
		// count of zero look identical on screen, so the request fails instead.
		stats, statErr := s.backend.GameStats(r.Context())
		if statErr != nil {
			s.dataFailure(w, r, "read play counts", statErr)
			return
		}
		for _, game := range games[:min(len(games), limit)] {
			// A game published between the two reads has no stat row yet; zero is
			// then the truth about it, not a substitute for an unknown.
			items = append(items, view(game, stats[game.Slug].Plays))
		}
	}

	var next *string
	if len(games) > limit {
		if cursor := nextCursor(games[limit-1]); cursor != "" {
			next = &cursor
		}
	}
	httpx.WriteJSON(w, r, http.StatusOK, gameListResponse{Items: items, NextCursor: next})
}

// followingFeed answers the caller's Following feed.
//
// The caller is resolved from the verified JWT identity the middleware placed
// in the context. There is no user-id parameter to get wrong: the only identity
// this handler can ever answer for is the one that proved itself with a token.
// The database function restricts output to published, creator-owned games of
// followed accounts in catalogue order; official ownerless games are excluded
// by the function, not by client filtering. Pagination is the same keyset
// cursor as the catalogue, so a game published between pages lands on a later
// page rather than duplicating a row.
func (s *service) followingFeed(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "read the following feed")
		return
	}

	id, ok := identity.FromContext(r.Context())
	if !ok || id.Anonymous || id.UserID == "" {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Sign in to view your following feed."))
		return
	}

	query, failure := parseFollowingQuery(r, id.UserID)
	if failure != nil {
		httpx.WriteError(w, r, failure)
		return
	}

	games, err := s.backend.FollowingGames(r.Context(), query.FollowingQuery)
	if err != nil {
		s.dataFailure(w, r, "read the following feed", err)
		return
	}

	limit := query.Limit
	items := make([]gameView, 0, min(len(games), limit))
	if len(games) > 0 {
		stats, statErr := s.backend.GameStats(r.Context())
		if statErr != nil {
			s.dataFailure(w, r, "read play counts", statErr)
			return
		}
		for _, game := range games[:min(len(games), limit)] {
			items = append(items, view(game, stats[game.Slug].Plays))
		}
	}

	var next *string
	if len(games) > limit {
		if cursor := nextCursor(games[limit-1]); cursor != "" {
			next = &cursor
		}
	}
	httpx.WriteJSON(w, r, http.StatusOK, gameListResponse{Items: items, NextCursor: next})
}

func (s *service) getGame(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "read a game")
		return
	}

	slug := strings.TrimSpace(r.PathValue("slug"))
	// The pattern is checked before the database so an obviously malformed path
	// is a 400 and a well-formed but unknown one is a 404 — two different
	// answers, and the caller can tell which mistake they made.
	if !gameSlugPattern.MatchString(slug) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid game slug.",
			apierr.Detail{Field: "slug", Rule: "format"}))
		return
	}

	game, found, err := s.backend.GetGame(r.Context(), slug)
	if err != nil {
		s.dataFailure(w, r, "read a game", err)
		return
	}
	if !found {
		// An unpublished game and a missing one are the same answer: telling
		// them apart would let a stranger enumerate drafts.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound, "No such game."))
		return
	}

	// A published game always has a stat row; if this one somehow does not, zero
	// plays is the honest answer for a game nobody has finished.
	plays := int64(0)
	stat, statFound, statErr := s.backend.GameStat(r.Context(), slug)
	if statErr != nil {
		s.dataFailure(w, r, "read a play count", statErr)
		return
	}
	if statFound {
		plays = stat.Plays
	}

	httpx.WriteJSON(w, r, http.StatusOK, view(game, plays))
}

// leaderboard answers one game's persisted ranking.
//
// The ranking is read straight from the database's board function, which derives
// it from recorded scores — the service neither caches nor recomputes it, so
// there is exactly one definition of "first place" in the system. An unknown or
// unpublished game is a 404, the same answer as reading it: a board for a game
// that does not exist is not an empty board.
func (s *service) leaderboard(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "read a leaderboard")
		return
	}

	slug := strings.TrimSpace(r.PathValue("slug"))
	if !gameSlugPattern.MatchString(slug) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"That is not a valid game slug.",
			apierr.Detail{Field: "slug", Rule: "format"}))
		return
	}

	query, failure := parseBoardQuery(r, time.Now().UTC())
	if failure != nil {
		httpx.WriteError(w, r, failure)
		return
	}

	game, found, err := s.backend.GetGame(r.Context(), slug)
	if err != nil {
		s.dataFailure(w, r, "read a game", err)
		return
	}
	if !found {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound, "No such game."))
		return
	}

	entries, err := s.backend.Leaderboard(r.Context(), slug, query.BoardQuery)
	if err != nil {
		s.dataFailure(w, r, "read a leaderboard", err)
		return
	}

	limit := query.Limit
	items := make([]leaderboardEntryView, 0, min(len(entries), limit))
	for _, entry := range entries[:min(len(entries), limit)] {
		items = append(items, leaderboardEntryView{
			Rank:       entry.Rank,
			Username:   entry.Username,
			Score:      entry.Score,
			AchievedAt: entry.AchievedAt,
			Plays:      entry.Plays,
		})
	}

	response := leaderboardResponse{
		GameSlug: game.Slug,
		Scope:    query.Scope,
		Period:   query.Period,
		Entries:  items,
		HasMore:  len(entries) > limit,
	}

	// The caller's own standing needs a verified identity, and nothing else in
	// this response does. An anonymous caller is served the board with a null
	// `me` rather than refused.
	if id, ok := identity.FromContext(r.Context()); ok && !id.Anonymous && id.UserID != "" {
		standing, ranked, standingErr := s.backend.Standing(r.Context(), slug, id.UserID, query.BoardQuery)
		if standingErr != nil {
			s.dataFailure(w, r, "read a standing", standingErr)
			return
		}
		if ranked {
			response.Me = &standingView{
				Rank:       standing.Rank,
				Score:      standing.Score,
				AchievedAt: standing.AchievedAt,
				Plays:      standing.Plays,
			}
		}
	}

	httpx.WriteJSON(w, r, http.StatusOK, response)
}

// overallLeaderboard answers the all-games board. As with a game's board, the
// ranking is the database's — this handler pages and presents it.
func (s *service) overallLeaderboard(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "read the all-games leaderboard")
		return
	}

	query, failure := parseBoardQuery(r, time.Now().UTC())
	if failure != nil {
		httpx.WriteError(w, r, failure)
		return
	}

	entries, err := s.backend.OverallLeaderboard(r.Context(), query.BoardQuery)
	if err != nil {
		s.dataFailure(w, r, "read the all-games leaderboard", err)
		return
	}

	limit := query.Limit
	items := make([]overallEntryView, 0, min(len(entries), limit))
	for _, entry := range entries[:min(len(entries), limit)] {
		items = append(items, overallEntryView{
			Rank:     entry.Rank,
			Username: entry.Username,
			Rating:   entry.Rating,
			Games:    entry.Games,
		})
	}

	response := overallLeaderboardResponse{
		Scope:    query.Scope,
		Period:   query.Period,
		MinGames: overallMinGames,
		Entries:  items,
		HasMore:  len(entries) > limit,
	}

	if id, ok := identity.FromContext(r.Context()); ok && !id.Anonymous && id.UserID != "" {
		standing, found, standingErr := s.backend.OverallStanding(r.Context(), id.UserID, query.BoardQuery)
		if standingErr != nil {
			s.dataFailure(w, r, "read an all-games standing", standingErr)
			return
		}
		if found {
			response.Me = &overallStandingView{
				Rank:   standing.Rank,
				Rating: standing.Rating,
				Games:  standing.Games,
			}
		}
	}

	httpx.WriteJSON(w, r, http.StatusOK, response)
}

func (s *service) listCategories(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil {
		s.notConfigured(w, r, "list categories")
		return
	}

	counts, err := s.backend.CategoryCounts(r.Context())
	if err != nil {
		s.dataFailure(w, r, "list categories", err)
		return
	}

	items := make([]categoryView, 0, len(counts))
	for _, count := range counts {
		items = append(items, categoryView{
			Slug:        count.Slug,
			Name:        count.Name,
			Description: count.Description,
			GameCount:   count.GameCount,
		})
	}
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Items []categoryView `json:"items"`
	}{Items: items})
}

// ── Query parsing ───────────────────────────────────────────────────────────

// boardQuery is a board page as the API describes it: the scope and window the
// caller asked for, plus the storage-level query they produce.
type boardQuery struct {
	supabasegames.BoardQuery
	Scope  string
	Period string
}

// parseBoardQuery validates a board request and turns its window into the
// timestamp the database filters on. The boundary is computed here rather than
// in SQL so that "today" is one value shared by the page and the caller's
// standing — two `now()` calls could straddle a score and disagree about it.
func parseBoardQuery(r *http.Request, now time.Time) (boardQuery, error) {
	values := r.URL.Query()
	query := boardQuery{
		BoardQuery: supabasegames.BoardQuery{Limit: defaultBoardLimit},
		Scope:      boardScopeGlobal,
		Period:     periodAll,
	}

	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxBoardLimit {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"limit must be a whole number between 1 and 100.",
				apierr.Detail{Field: "limit", Rule: "range"})
		}
		query.Limit = limit
	}

	if raw := strings.TrimSpace(values.Get("offset")); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 || offset > maxBoardOffset {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"offset must be a whole number between 0 and 10000.",
				apierr.Detail{Field: "offset", Rule: "range"})
		}
		query.Offset = offset
	}

	if raw := strings.TrimSpace(values.Get("scope")); raw != "" && raw != boardScopeGlobal {
		// Told apart from a typo on purpose: `friends` is a real, unimplemented
		// scope, and a caller asking for it deserves to know why it is refused.
		message := "That is not a board scope."
		if raw == "friends" {
			message = "A friends board needs a following graph, which does not exist yet. The global board is available."
		}
		return query, httpx.NewError(httpx.CodeBadRequest, message,
			apierr.Detail{Field: "scope", Rule: "unsupported"})
	}

	if raw := strings.TrimSpace(values.Get("period")); raw != "" {
		if !boardPeriods[raw] {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"period must be one of all, day or week.",
				apierr.Detail{Field: "period", Rule: "unsupported"})
		}
		query.Period = raw
		switch raw {
		case periodDay:
			query.Since, query.HasSince = now.Add(-24*time.Hour), true
		case periodWeek:
			query.Since, query.HasSince = now.Add(-7*24*time.Hour), true
		}
	}

	return query, nil
}

// listQuery is a catalogue page as the API describes it.
//
// CategorySlug is carried alongside the storage-level query because a slug is
// what the API accepts and an id is what the foreign key stores; the handler
// resolves one into the other before calling the backend, and a request that
// names no category never pays for that lookup.
type listQuery struct {
	supabasegames.ListQuery
	CategorySlug string
}

func parseListQuery(r *http.Request) (listQuery, error) {
	values := r.URL.Query()
	query := listQuery{ListQuery: supabasegames.ListQuery{Limit: defaultPageLimit}}

	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageLimit {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"limit must be a whole number between 1 and 100.",
				apierr.Detail{Field: "limit", Rule: "range"})
		}
		query.Limit = limit
	}

	if raw := strings.TrimSpace(values.Get("sort")); raw != "" && raw != supportedSort {
		return query, httpx.NewError(httpx.CodeBadRequest,
			"The catalogue can only be sorted by recency. Popular and trending need play data that does not exist yet.",
			apierr.Detail{Field: "sort", Rule: "unsupported"})
	}

	if raw := strings.TrimSpace(values.Get("category")); raw != "" {
		if !categorySlugPattern.MatchString(raw) {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That is not a valid category slug.",
				apierr.Detail{Field: "category", Rule: "format"})
		}
		query.CategorySlug = raw
	}

	if raw := strings.TrimSpace(values.Get("q")); raw != "" {
		if len([]rune(raw)) > maxSearchRunes {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"Search terms are limited to 100 characters.",
				apierr.Detail{Field: "q", Rule: "maxLength"})
		}
		term, ok := supabasegames.SearchTerm(raw)
		if !ok {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That search has no searchable characters.",
				apierr.Detail{Field: "q", Rule: "invalid"})
		}
		query.Search = term
	}

	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		if len(raw) > maxCursorLength {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That cursor is not valid.",
				apierr.Detail{Field: "cursor", Rule: "maxLength"})
		}
		after, id, err := decodeCursor(raw)
		if err != nil {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That cursor is not valid.",
				apierr.Detail{Field: "cursor", Rule: "format"})
		}
		query.AfterPublishedAt, query.AfterID, query.HasAfter = after, id, true
	}

	return query, nil
}

// followingQuery is one Following-feed page: the verified follower plus the
// same limit/cursor/search contract as the catalogue.
type followingQuery struct {
	supabasegames.FollowingQuery
}

// parseFollowingQuery validates a Following-feed request. The follower comes
// from the verified identity argument, never from the query string, so a
// caller cannot ask for another user's feed.
func parseFollowingQuery(r *http.Request, followerID string) (followingQuery, error) {
	values := r.URL.Query()
	query := followingQuery{FollowingQuery: supabasegames.FollowingQuery{FollowerID: followerID, Limit: defaultPageLimit}}

	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 || limit > maxPageLimit {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"limit must be a whole number between 1 and 100.",
				apierr.Detail{Field: "limit", Rule: "range"})
		}
		query.Limit = limit
	}

	if raw := strings.TrimSpace(values.Get("q")); raw != "" {
		if len([]rune(raw)) > maxSearchRunes {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"Search terms are limited to 100 characters.",
				apierr.Detail{Field: "q", Rule: "maxLength"})
		}
		term, ok := supabasegames.SearchTerm(raw)
		if !ok {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That search has no searchable characters.",
				apierr.Detail{Field: "q", Rule: "invalid"})
		}
		query.Search = term
	}

	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		if len(raw) > maxCursorLength {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That cursor is not valid.",
				apierr.Detail{Field: "cursor", Rule: "maxLength"})
		}
		after, id, err := decodeCursor(raw)
		if err != nil {
			return query, httpx.NewError(httpx.CodeBadRequest,
				"That cursor is not valid.",
				apierr.Detail{Field: "cursor", Rule: "format"})
		}
		query.AfterPublishedAt, query.AfterID, query.HasAfter = after, id, true
	}

	return query, nil
}

// ── Cursor ──────────────────────────────────────────────────────────────────
//
// The cursor is the sort key of the last row on the previous page: its
// publication timestamp and its id. Re-reading from that pair is what makes
// paging stable — a game published between two requests lands on a later page
// rather than shifting every following row and duplicating one.
//
// It is opaque (base64url over `v1|<timestamp>|<id>`) so a client cannot be
// tempted to construct one, and a malformed value is a clear 400 rather than a
// confusing empty page.

func nextCursor(game supabasegames.Game) string {
	// A published game always has a publication timestamp — publishing stamps it
	// in the database. If one somehow does not, it sorts last, so the listing
	// simply ends there instead of emitting a cursor that could not be re-read.
	if game.PublishedAt == nil {
		return ""
	}
	payload := strings.Join([]string{
		cursorPrefix,
		game.PublishedAt.UTC().Format(time.RFC3339Nano),
		game.ID,
	}, "|")
	return base64.RawURLEncoding.EncodeToString([]byte(payload))
}

func decodeCursor(raw string) (time.Time, string, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return time.Time{}, "", err
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 3 || parts[0] != cursorPrefix {
		return time.Time{}, "", errors.New("cursor is not a catalogue cursor")
	}
	stamp, err := time.Parse(time.RFC3339Nano, parts[1])
	if err != nil {
		return time.Time{}, "", err
	}
	if !uuidPattern.MatchString(parts[2]) {
		return time.Time{}, "", errors.New("cursor carries no usable id")
	}
	return stamp, parts[2], nil
}

// ── Failures ────────────────────────────────────────────────────────────────

// notConfigured answers a route whose Supabase dependency is missing. It names no
// variable and carries no value: the log line is where the operator finds out
// what to set.
func (s *service) notConfigured(w http.ResponseWriter, r *http.Request, operation string) {
	s.logger.WarnContext(r.Context(), "games dependency is not configured", slog.String("operation", operation))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The game catalogue is not available right now."))
}

// dataFailure maps a Data API failure onto the platform's envelope.
//
// Only a message written here is ever sent. The database's own text can describe
// the schema, and a caller's search term can appear in it, so the machine-readable
// code decides the classification and the wording is ours.
func (s *service) dataFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var dataErr *supabasegames.Error
	if errors.As(err, &dataErr) && dataErr.IsForbidden() {
		s.logger.ErrorContext(r.Context(), "the catalogue read was refused by the database",
			slog.String("operation", operation), slog.String("code", dataErr.Code))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The game catalogue is not available right now."))
		return
	}

	s.logger.ErrorContext(r.Context(), "catalogue call failed",
		slog.String("operation", operation),
		slog.Any("error", err),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The game catalogue is not available right now."))
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Options returns the wiring every games entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, _ *authn.Verifier) {
			var backend Backend
			client, err := supabasegames.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its
				// probes and answers 503 on the catalogue routes, which is far
				// more diagnosable than a crash loop. The error names the missing
				// variables and carries no value.
				logger.Warn("Supabase is not configured; the catalogue routes answer 503",
					slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, logger).register(router)
		},
	}
}
