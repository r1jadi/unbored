package notifications

import (
	"context"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

const testPostalAddress = "1 Test Street, Testville, TS 00000"

// Marketing email is refused without a postal address, so every test service
// is built with one unless a test clears it.
func TestMain(m *testing.M) {
	os.Setenv("EMAIL_POSTAL_ADDRESS", testPostalAddress)
	os.Setenv("PUBLIC_API_URL", "https://api.example.test")
	os.Exit(m.Run())
}

type fakeUnsubscriber struct {
	calls []string
}

func (f *fakeUnsubscriber) Unsubscribe(_ context.Context, userID, kind string) error {
	f.calls = append(f.calls, kind+"/"+userID)
	return nil
}

func TestDigestCarriesUnsubscribeLinkHeadersAndAddress(t *testing.T) {
	backend := &fakeBackend{
		claimID: "digest-1",
		found:   true,
		games:   testGames(),
		recipients: [][]supabasedigest.Recipient{
			{{UserID: "user-1", Email: "player@example.com"}},
			nil,
		},
	}
	mailer := &fakeMailer{enabled: true}
	s := newService(backend, mailer, testLogger(), "cron-secret", "https://example.test")
	if rec, _ := doDigest(t, s, "Bearer cron-secret"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	msg := mailer.sent[0]
	link := s.signer.URL("user-1", kindNewGames)
	for _, body := range []string{msg.HTML, msg.Text} {
		if !strings.Contains(body, testPostalAddress) {
			t.Error("email has no postal address")
		}
	}
	if !strings.Contains(msg.Text, link) || !strings.Contains(msg.HTML, strings.ReplaceAll(link, "&", "&amp;")) {
		t.Error("email has no unsubscribe link")
	}
	if msg.Headers["List-Unsubscribe"] != "<"+link+">" ||
		msg.Headers["List-Unsubscribe-Post"] != "List-Unsubscribe=One-Click" {
		t.Errorf("headers = %v", msg.Headers)
	}
}

func TestDigestIsNotSentWithoutAPostalAddress(t *testing.T) {
	backend := &fakeBackend{claimID: "digest-1", found: true, games: testGames()}
	mailer := &fakeMailer{enabled: true}
	s := newService(backend, mailer, testLogger(), "cron-secret", "https://example.test")
	s.address = ""
	if rec, _ := doDigest(t, s, "Bearer cron-secret"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if len(mailer.sent) != 0 {
		t.Fatal("an email was sent without a postal address")
	}
}

func TestUnsubscribeLinkConfirmsThenUnsubscribesWithoutSignIn(t *testing.T) {
	backend := &fakeUnsubscriber{}
	signer := newUnsubscribeSigner("cron-secret", "https://api.example.test")
	s := newUnsubscribeService(backend, signer, testLogger(), "https://example.test")
	link, err := url.Parse(signer.URL("user-1", kindWeeklyRecap))
	if err != nil {
		t.Fatal(err)
	}

	get := httptest.NewRecorder()
	s.confirm(get, httptest.NewRequest(http.MethodGet, link.RequestURI(), nil))
	if get.Code != http.StatusOK || !strings.Contains(get.Body.String(), "<form method=\"post\"") {
		t.Fatalf("GET = %d %s", get.Code, get.Body.String())
	}
	if len(backend.calls) != 0 {
		t.Fatal("GET changed a preference")
	}

	post := httptest.NewRecorder()
	s.unsubscribe(post, httptest.NewRequest(http.MethodPost, link.RequestURI(),
		strings.NewReader("List-Unsubscribe=One-Click")))
	if post.Code != http.StatusOK {
		t.Fatalf("POST = %d", post.Code)
	}
	if len(backend.calls) != 1 || backend.calls[0] != "weekly-recap/user-1" {
		t.Fatalf("calls = %v", backend.calls)
	}
}

func TestUnsubscribeRefusesATamperedLink(t *testing.T) {
	backend := &fakeUnsubscriber{}
	signer := newUnsubscribeSigner("cron-secret", "")
	s := newUnsubscribeService(backend, signer, testLogger(), "")
	link, _ := url.Parse(signer.URL("user-1", kindNewGames))
	query := link.Query()
	query.Set("u", "user-2")
	link.RawQuery = query.Encode()

	rec := httptest.NewRecorder()
	s.unsubscribe(rec, httptest.NewRequest(http.MethodPost, link.RequestURI(), nil))
	if rec.Code != http.StatusBadRequest || len(backend.calls) != 0 {
		t.Fatalf("status = %d, calls = %v", rec.Code, backend.calls)
	}
}
