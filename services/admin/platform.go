package admin

import (
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/admin/internal/supabaseadmin"
)

const (
	// FeaturedPath reads and replaces the editorial slots.
	FeaturedPath = "/api/v1/admin/featured"
	// BroadcastsPath lists and sends announcements.
	BroadcastsPath = "/api/v1/admin/broadcasts"
	// BroadcastPath edits or deletes one announcement that was already sent.
	BroadcastPath = "/api/v1/admin/broadcasts/{broadcastID}"
	// PlatformSettingsPath reads and changes what can be set at runtime.
	PlatformSettingsPath = "/api/v1/admin/system/settings"

	maxFeaturedGames = 12
	maxBannerRunes   = 200
)

// broadcastLink is a path inside the app, so an announcement can't send every
// player to another site. The database holds the same rule.
var broadcastLink = regexp.MustCompile(`^/[^/\\]`)

// broadcastGame is a catalogue slug. The database checks that the game is published.
var broadcastGame = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// The parts an administrator picks so an announcement looks like the notifications
// Unbored sends by itself: a label with an icon, and a button.
var (
	broadcastStyles  = map[string]bool{"news": true, "new_game": true, "feature": true, "event": true, "theme": true, "update": true}
	broadcastActions = map[string]bool{"open": true, "play": true, "try": true, "look": true}
)

type featuredView struct {
	GameID        string    `json:"gameId"`
	Slug          string    `json:"slug"`
	Title         string    `json:"title"`
	Status        string    `json:"status"`
	Position      int       `json:"position"`
	SetByUsername *string   `json:"setByUsername"`
	SetAt         time.Time `json:"setAt"`
}

func (s *service) listFeatured(w http.ResponseWriter, r *http.Request) {
	rows, err := s.backend.FeaturedGames(r.Context(), s.token(r), s.actor(r))
	if err != nil {
		s.dataFailure(w, r, "read featured games", err)
		return
	}
	items := make([]featuredView, 0, len(rows))
	for _, row := range rows {
		items = append(items, featuredView{
			GameID:        row.GameID,
			Slug:          row.Slug,
			Title:         row.Title,
			Status:        row.GameStatus,
			Position:      row.Position,
			SetByUsername: row.SetByUsername,
			SetAt:         row.SetAt,
		})
	}
	httpx.WriteJSON(w, r, http.StatusOK, struct {
		Items []featuredView `json:"items"`
	}{Items: items})
}

type setFeaturedRequest struct {
	GameIDs []string `json:"gameIds"`
}

func (s *service) setFeatured(w http.ResponseWriter, r *http.Request) {
	var body setFeaturedRequest
	if !s.decode(w, r, &body) {
		return
	}
	if len(body.GameIDs) > maxFeaturedGames {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"At most 12 games can be featured.",
			apierr.Detail{Field: "gameIds", Rule: "maxItems"}))
		return
	}
	seen := make(map[string]bool, len(body.GameIDs))
	ids := make([]string, 0, len(body.GameIDs))
	for _, id := range body.GameIDs {
		id = strings.ToLower(strings.TrimSpace(id))
		if !uuidPattern.MatchString(id) || seen[id] {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
				"Each featured game must be a different, valid game id.",
				apierr.Detail{Field: "gameIds", Rule: "format"}))
			return
		}
		seen[id] = true
		ids = append(ids, id)
	}
	if err := s.backend.SetFeaturedGames(r.Context(), s.token(r), s.actor(r), ids); err != nil {
		s.moderationFailure(w, r, "change featured games", err)
		return
	}
	s.listFeatured(w, r)
}

func (s *service) getPlatformSettings(w http.ResponseWriter, r *http.Request) {
	settings, err := s.backend.PlatformSettings(r.Context(), s.token(r), s.actor(r))
	if err != nil {
		s.dataFailure(w, r, "read platform settings", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, settings)
}

type setPlatformSettingsRequest struct {
	BannerText      string `json:"bannerText"`
	CommentsEnabled *bool  `json:"commentsEnabled"`
	MessagesEnabled *bool  `json:"messagesEnabled"`
}

func (s *service) setPlatformSettings(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	var body setPlatformSettingsRequest
	if !s.decode(w, r, &body) {
		return
	}
	if body.CommentsEnabled == nil || body.MessagesEnabled == nil {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"Every setting needs a value.",
			apierr.Detail{Field: "commentsEnabled", Rule: "required"}))
		return
	}
	banner := strings.TrimSpace(body.BannerText)
	if utf8.RuneCountInString(banner) > maxBannerRunes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"The banner is limited to 200 characters.",
			apierr.Detail{Field: "bannerText", Rule: "maxLength"}))
		return
	}
	if err := s.backend.SetPlatformSettings(r.Context(), s.token(r), s.actor(r), banner, *body.CommentsEnabled, *body.MessagesEnabled); err != nil {
		s.moderationFailure(w, r, "change platform settings", err)
		return
	}
	s.getPlatformSettings(w, r)
}

type broadcastView struct {
	ID             string    `json:"id"`
	Title          string    `json:"title"`
	Body           string    `json:"body"`
	Link           *string   `json:"link"`
	Style          string    `json:"style"`
	Game           *string   `json:"game"`
	Action         *string   `json:"action"`
	SentByUsername *string   `json:"sentByUsername"`
	Recipients     int64     `json:"recipients"`
	ReadCount      int64     `json:"readCount"`
	CreatedAt      time.Time `json:"createdAt"`
}

func (s *service) listBroadcasts(w http.ResponseWriter, r *http.Request) {
	page, ok := s.page(w, r)
	if !ok {
		return
	}
	rows, err := s.backend.Broadcasts(r.Context(), s.token(r), s.actor(r), page)
	if err != nil {
		s.dataFailure(w, r, "list broadcasts", err)
		return
	}
	hasMore := len(rows) > page.Limit
	if hasMore {
		rows = rows[:page.Limit]
	}
	items := make([]broadcastView, 0, len(rows))
	for _, row := range rows {
		items = append(items, broadcastView{
			ID:             row.ID,
			Title:          row.Title,
			Body:           row.Body,
			Link:           row.Link,
			Style:          row.Style,
			Game:           row.Game,
			Action:         row.Action,
			SentByUsername: row.SentByUsername,
			Recipients:     row.Recipients,
			ReadCount:      row.ReadCount,
			CreatedAt:      row.CreatedAt,
		})
	}
	s.writePage(w, r, items, hasMore)
}

type sendBroadcastRequest struct {
	Title  string `json:"title"`
	Body   string `json:"body"`
	Link   string `json:"link"`
	Style  string `json:"style"`
	Game   string `json:"game"`
	Action string `json:"action"`
}

func (s *service) sendBroadcast(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	message, ok := s.broadcastBody(w, r)
	if !ok {
		return
	}
	result, err := s.backend.SendBroadcast(r.Context(), s.token(r), s.actor(r), message)
	if err != nil {
		s.moderationFailure(w, r, "send a broadcast", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusCreated, result)
}

// broadcastBody reads and validates an announcement, for sending one and for editing
// one. The database holds the same rules.
func (s *service) broadcastBody(w http.ResponseWriter, r *http.Request) (supabaseadmin.BroadcastMessage, bool) {
	var body sendBroadcastRequest
	if !s.decode(w, r, &body) {
		return supabaseadmin.BroadcastMessage{}, false
	}
	m := supabaseadmin.BroadcastMessage{
		Title:  strings.TrimSpace(body.Title),
		Body:   strings.TrimSpace(body.Body),
		Link:   strings.TrimSpace(body.Link),
		Style:  strings.TrimSpace(body.Style),
		Game:   strings.ToLower(strings.TrimSpace(body.Game)),
		Action: strings.TrimSpace(body.Action),
	}
	if m.Style == "" {
		m.Style = "news"
	}
	fail := func(message, field, rule string) (supabaseadmin.BroadcastMessage, bool) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest, message,
			apierr.Detail{Field: field, Rule: rule}))
		return supabaseadmin.BroadcastMessage{}, false
	}
	if n := utf8.RuneCountInString(m.Title); n < 3 || n > 80 {
		return fail("A title is 3 to 80 characters.", "title", "length")
	}
	if n := utf8.RuneCountInString(m.Body); n < 3 || n > 300 {
		return fail("A message is 3 to 300 characters.", "body", "length")
	}
	if m.Link != "" && (len(m.Link) > 200 || !broadcastLink.MatchString(m.Link)) {
		return fail("A link must be a path inside Unbored, such as /games/sudoku.", "link", "format")
	}
	if !broadcastStyles[m.Style] {
		return fail("Pick a type from the list.", "style", "enum")
	}
	if m.Action != "" && !broadcastActions[m.Action] {
		return fail("Pick a button from the list.", "action", "enum")
	}
	if m.Game != "" && !broadcastGame.MatchString(m.Game) {
		return fail("Pick a game from the list.", "game", "format")
	}
	if m.Style == "new_game" && m.Game == "" {
		return fail("A new-game announcement needs a game.", "game", "required")
	}
	if m.Action == "play" && m.Game == "" {
		return fail("A Play button needs a game.", "game", "required")
	}
	if m.Action != "" && m.Action != "play" && m.Link == "" {
		return fail("This button needs a link.", "link", "required")
	}
	return m, true
}

// updateBroadcast rewrites an announcement that was already sent, in the console and
// in every inbox that holds it. Nobody is notified again.
func (s *service) updateBroadcast(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	id, ok := s.pathID(w, r, "broadcastID", "announcement")
	if !ok {
		return
	}
	message, ok := s.broadcastBody(w, r)
	if !ok {
		return
	}
	if err := s.backend.UpdateBroadcast(r.Context(), s.token(r), s.actor(r), id, message); err != nil {
		s.moderationFailure(w, r, "edit a broadcast", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, broadcastChangeView{ID: strings.ToLower(id)})
}

// deleteBroadcast removes an announcement from the console and from every inbox.
func (s *service) deleteBroadcast(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdminTier(w, r) {
		return
	}
	id, ok := s.pathID(w, r, "broadcastID", "announcement")
	if !ok {
		return
	}
	if err := s.backend.DeleteBroadcast(r.Context(), s.token(r), s.actor(r), id); err != nil {
		s.moderationFailure(w, r, "delete a broadcast", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, broadcastChangeView{ID: strings.ToLower(id)})
}

type broadcastChangeView struct {
	ID string `json:"id"`
}

// requireAdminTier re-checks the tier the staff wrapper authorized. With the secret
// configured every staff call runs through the administrator bridge, so a moderator
// must be stopped here: the database guard would see an administrator.
func (s *service) requireAdminTier(w http.ResponseWriter, r *http.Request) bool {
	tier, _ := r.Context().Value(staffTierKey).(staffTier)
	if tier != tierAdmin {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeForbidden,
			"This action requires an administrator."))
		return false
	}
	return true
}
