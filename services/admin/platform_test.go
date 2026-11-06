package admin

import (
	"net/http"
	"strings"
	"testing"
)

const (
	featuredGameA = "11111111-1111-4111-8111-111111111111"
	featuredGameB = "22222222-2222-4222-8222-222222222222"
)

// With the secret configured every staff call runs through the administrator bridge,
// so the database can't tell a moderator from an administrator. These writes reach
// every player, so a moderator has to be stopped before the database is touched.
func TestModeratorCannotBroadcastOrChangeSettings(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}, dbRole: "moderator"}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testModerator, "moderator", "mod@example.com")

	if status, payload := call(t, server, http.MethodPost, BroadcastsPath, token,
		map[string]any{"title": "Big news", "body": "Something new"}); status != http.StatusForbidden {
		t.Errorf("a moderator broadcasting = %d, want 403 (%v)", status, payload)
	}
	if status, payload := call(t, server, http.MethodPatch, PlatformSettingsPath, token,
		map[string]any{"bannerText": "", "commentsEnabled": false, "messagesEnabled": true}); status != http.StatusForbidden {
		t.Errorf("a moderator changing settings = %d, want 403 (%v)", status, payload)
	}
	if backend.called("SendBroadcast") || backend.called("SetPlatformSettings") {
		t.Error("a refused write reached the database")
	}

	// Reading both, and arranging featured games, is moderation work.
	for _, path := range []string{BroadcastsPath, PlatformSettingsPath, FeaturedPath} {
		if status, payload := call(t, server, http.MethodGet, path, token, nil); status != http.StatusOK {
			t.Errorf("a moderator reading %s = %d, want 200 (%v)", path, status, payload)
		}
	}
	if status, payload := call(t, server, http.MethodPut, FeaturedPath, token,
		map[string]any{"gameIds": []string{featuredGameA}}); status != http.StatusOK {
		t.Errorf("a moderator featuring a game = %d, want 200 (%v)", status, payload)
	}
	if !backend.called("SetFeaturedGames") {
		t.Error("featuring a game never reached the database")
	}
}

func TestAdministratorCanBroadcastAndChangeSettings(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "admin", "admin@example.com")

	status, payload := call(t, server, http.MethodPost, BroadcastsPath, token,
		map[string]any{"title": "Big news", "body": "Something new", "link": "/games/sudoku"})
	if status != http.StatusCreated || payload["recipients"] != float64(3) {
		t.Errorf("broadcast = %d %v, want 201 with its reach", status, payload)
	}
	if status, payload := call(t, server, http.MethodPatch, PlatformSettingsPath, token,
		map[string]any{"bannerText": "Back soon", "commentsEnabled": false, "messagesEnabled": true}); status != http.StatusOK {
		t.Errorf("settings = %d, want 200 (%v)", status, payload)
	}
	if backend.lastActor != testAdmin {
		t.Errorf("attributed to %q, want the verified administrator", backend.lastActor)
	}
}

func TestPlatformWritesValidateBeforeTheDatabase(t *testing.T) {
	t.Setenv("ADMIN_EMAILS", "admin@example.com")
	backend := &guardBackend{fakeBackend: &fakeBackend{}}
	server, sign := newAllowlistServer(t, backend)
	token := sign(testAdmin, "admin", "admin@example.com")

	cases := []struct {
		name   string
		method string
		path   string
		body   map[string]any
	}{
		{"short title", http.MethodPost, BroadcastsPath, map[string]any{"title": "x", "body": "Something new"}},
		{"long body", http.MethodPost, BroadcastsPath, map[string]any{"title": "Big news", "body": strings.Repeat("x", 301)}},
		{"outside link", http.MethodPost, BroadcastsPath, map[string]any{"title": "Big news", "body": "Something new", "link": "https://evil.example"}},
		{"scheme-relative link", http.MethodPost, BroadcastsPath, map[string]any{"title": "Big news", "body": "Something new", "link": "//evil.example"}},
		{"backslash link", http.MethodPost, BroadcastsPath, map[string]any{"title": "Big news", "body": "Something new", "link": `/\evil.example`}},
		{"long banner", http.MethodPatch, PlatformSettingsPath, map[string]any{"bannerText": strings.Repeat("x", 201), "commentsEnabled": true, "messagesEnabled": true}},
		{"missing switch", http.MethodPatch, PlatformSettingsPath, map[string]any{"bannerText": ""}},
		{"bad game id", http.MethodPut, FeaturedPath, map[string]any{"gameIds": []string{"nope"}}},
		{"same game twice", http.MethodPut, FeaturedPath, map[string]any{"gameIds": []string{featuredGameB, featuredGameB}}},
		{"too many games", http.MethodPut, FeaturedPath, map[string]any{"gameIds": make([]string, 13)}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if status, payload := call(t, server, c.method, c.path, token, c.body); status != http.StatusBadRequest {
				t.Errorf("%s = %d, want 400 (%v)", c.name, status, payload)
			}
		})
	}
	if backend.called("SendBroadcast") || backend.called("SetPlatformSettings") || backend.called("SetFeaturedGames") {
		t.Error("an invalid write reached the database")
	}
}
