package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/services/internal/email"
	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

type recordedDelivery struct {
	userID  string
	failure string
}

type fakeBackend struct {
	claimID    string
	found      bool
	claimErr   error
	games      []supabasedigest.Game
	recipients [][]supabasedigest.Recipient
	recipErr   error
	records    []recordedDelivery
	closed     bool
	claimCalls int
}

func (f *fakeBackend) Claim(context.Context) (string, bool, error) {
	f.claimCalls++
	return f.claimID, f.found, f.claimErr
}

func (f *fakeBackend) Games(context.Context, string) ([]supabasedigest.Game, error) {
	return f.games, nil
}

func (f *fakeBackend) Recipients(context.Context, string, int) ([]supabasedigest.Recipient, error) {
	if f.recipErr != nil {
		return nil, f.recipErr
	}
	if len(f.recipients) == 0 {
		return nil, nil
	}
	batch := f.recipients[0]
	f.recipients = f.recipients[1:]
	return batch, nil
}

func (f *fakeBackend) Record(_ context.Context, _, userID, failure string) error {
	f.records = append(f.records, recordedDelivery{userID: userID, failure: failure})
	return nil
}

func (f *fakeBackend) Close(context.Context, string) (bool, error) {
	f.closed = true
	return true, nil
}

type fakeMailer struct {
	enabled bool
	err     error
	sent    []email.Message
}

func (f *fakeMailer) Configured() bool { return f.enabled }

func (f *fakeMailer) Send(_ context.Context, msg email.Message) (string, error) {
	f.sent = append(f.sent, msg)
	if f.err != nil {
		return "", f.err
	}
	return "email-id", nil
}

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

func testGames() []supabasedigest.Game {
	instructions := "Fill a line.\nWatch it burst."
	return []supabasedigest.Game{
		{Slug: "gridburst", Title: "Gridburst", Instructions: &instructions},
		{Slug: "crossword", Title: "Daily Crossword", Instructions: nil},
	}
}

func doDigest(t *testing.T, s *service, authorization string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, DigestPath, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	s.sendDigest(rec, req)

	var body map[string]any
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatalf("response is not JSON: %v (%s)", err, rec.Body.String())
		}
	}
	return rec, body
}

func TestDigestIsDisabledWithoutCronSecret(t *testing.T) {
	backend := &fakeBackend{}
	s := newService(backend, &fakeMailer{enabled: true}, testLogger(), "", "https://example.test")

	rec, _ := doDigest(t, s, "Bearer anything")
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if backend.claimCalls != 0 {
		t.Fatalf("claim calls = %d, want none", backend.claimCalls)
	}
}

func TestDigestRejectsTheWrongSecret(t *testing.T) {
	backend := &fakeBackend{}
	s := newService(backend, &fakeMailer{enabled: true}, testLogger(), "cron-secret", "https://example.test")

	rec, _ := doDigest(t, s, "Bearer not-the-secret")
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
	if backend.claimCalls != 0 {
		t.Fatalf("claim calls = %d, want none", backend.claimCalls)
	}
}

func TestDigestIsIdleUntilFiveGamesWait(t *testing.T) {
	backend := &fakeBackend{found: false}
	s := newService(backend, &fakeMailer{enabled: true}, testLogger(), "cron-secret", "https://example.test")

	rec, body := doDigest(t, s, "Bearer cron-secret")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["status"] != "idle" {
		t.Fatalf("body = %v, want idle", body)
	}
}

func TestDigestSendsGamesAndRecordsEachRecipient(t *testing.T) {
	backend := &fakeBackend{
		claimID: "digest-1",
		found:   true,
		games:   testGames(),
		recipients: [][]supabasedigest.Recipient{
			{{UserID: "user-1", Email: "player@example.com", Username: "player", DisplayName: "Player"}},
			nil,
		},
	}
	mailer := &fakeMailer{enabled: true}
	s := newService(backend, mailer, testLogger(), "cron-secret", "https://example.test")

	rec, body := doDigest(t, s, "Bearer cron-secret")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (%s)", rec.Code, rec.Body.String())
	}
	if body["status"] != "sent" || body["sent"] != float64(1) || body["closed"] != true {
		t.Fatalf("body = %v", body)
	}
	if len(mailer.sent) != 1 {
		t.Fatalf("sent %d messages, want 1", len(mailer.sent))
	}
	msg := mailer.sent[0]
	if msg.To[0] != "player@example.com" {
		t.Fatalf("to = %v", msg.To)
	}
	if !strings.Contains(msg.Subject, "2 new games") {
		t.Errorf("subject = %q", msg.Subject)
	}
	for _, want := range []string{"Gridburst", "Fill a line.", "Daily Crossword", "https://example.test/play/gridburst", "https://example.test/settings/notifications"} {
		if !strings.Contains(msg.HTML, want) {
			t.Errorf("HTML does not contain %q", want)
		}
		if !strings.Contains(msg.Text, strings.ReplaceAll(want, "&", "&amp;")) && !strings.Contains(msg.Text, want) {
			t.Errorf("text does not contain %q", want)
		}
	}
	if len(backend.records) != 1 || backend.records[0].userID != "user-1" || backend.records[0].failure != "" {
		t.Fatalf("records = %+v", backend.records)
	}
	if !backend.closed {
		t.Fatal("digest was not closed")
	}
}

func TestDigestRecordsAFailedSend(t *testing.T) {
	backend := &fakeBackend{
		claimID: "digest-1",
		found:   true,
		games:   testGames(),
		recipients: [][]supabasedigest.Recipient{
			{{UserID: "user-1", Email: "player@example.com"}},
			nil,
		},
	}
	mailer := &fakeMailer{enabled: true, err: errors.New("resend rejected the send")}
	s := newService(backend, mailer, testLogger(), "cron-secret", "https://example.test")

	rec, body := doDigest(t, s, "Bearer cron-secret")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if body["failed"] != float64(1) || body["sent"] != float64(0) {
		t.Fatalf("body = %v", body)
	}
	if len(backend.records) != 1 || backend.records[0].failure == "" {
		t.Fatalf("records = %+v, want one failure", backend.records)
	}
}

func TestDigestEscapesGameTextInHTML(t *testing.T) {
	instructions := `<script>alert("x")</script>`
	games := []supabasedigest.Game{{Slug: "game", Title: `<b>Title</b>`, Instructions: &instructions}}
	content, err := renderDigest(games, "https://example.test")
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if strings.Contains(content.HTML, "<script>") || strings.Contains(content.HTML, "<b>Title</b>") {
		t.Fatalf("HTML was not escaped: %s", content.HTML)
	}
	if !strings.Contains(content.HTML, "&lt;script&gt;") {
		t.Errorf("expected escaped instructions in %s", content.HTML)
	}
}
