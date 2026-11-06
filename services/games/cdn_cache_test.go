package games

import (
	"net/http"
	"testing"

	"github.com/r1jadi/unbored/services/internal/apiroutes"
)

const cdnHeader = apiroutes.CDNCachePolicyHeader

func requestHeaders(t *testing.T, url, token string) (int, http.Header) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		t.Fatal(err)
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("GET %s: %v", url, err)
	}
	defer response.Body.Close()
	return response.StatusCode, response.Header
}

func TestPublicReadsCanBeKeptByTheCDN(t *testing.T) {
	backend := testBackend()
	backend.entries = testBoard()
	server := testServer(t, backend)

	for _, path := range []string{GamesPath, "/api/v1/games/stack-10", CategoriesPath, boardPath} {
		status, headers := requestHeaders(t, server.URL+path, "")
		if status != http.StatusOK {
			t.Errorf("%s = %d, want 200", path, status)
		}
		if headers.Get(cdnHeader) == "" {
			t.Errorf("%s: the CDN isn't allowed to keep this", path)
		}
		// The service keeps the API's baseline; the gateway decides what leaves it.
		if got := headers.Get("Cache-Control"); got != "no-store" {
			t.Errorf("%s: Cache-Control = %q, want no-store", path, got)
		}
	}
}

func TestFailuresAreNeverKeptByTheCDN(t *testing.T) {
	server := testServer(t, testBackend())

	status, headers := requestHeaders(t, server.URL+"/api/v1/games/no-such-game", "")
	if status != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", status)
	}
	if got := headers.Get(cdnHeader); got != "" {
		t.Errorf("a 404 may be cached for %q", got)
	}
}

func TestSignedInBoardsAreNeverKeptByTheCDN(t *testing.T) {
	backend := testBackend()
	backend.entries = testBoard()
	server, sign := testServerWithAuth(t, backend)

	status, headers := requestHeaders(t, server.URL+boardPath, sign("11111111-1111-4111-8111-111111111111"))
	if status != http.StatusOK {
		t.Fatalf("status = %d, want 200", status)
	}
	if got := headers.Get(cdnHeader); got != "" {
		t.Errorf("a board with the caller's own standing may be cached for %q", got)
	}
}
