package notifications

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

type fakeRecapBackend struct {
	pending  []supabasedigest.RecapRecipient
	recorded map[string]string
	weeks    map[string]string
}

func (f *fakeRecapBackend) RecapRecipients(_ context.Context, limit int) ([]supabasedigest.RecapRecipient, error) {
	var out []supabasedigest.RecapRecipient
	for _, r := range f.pending {
		if _, done := f.recorded[r.UserID]; !done {
			out = append(out, r)
		}
		if len(out) == limit {
			break
		}
	}
	return out, nil
}

func (f *fakeRecapBackend) RecordRecap(_ context.Context, week, userID, failure string) error {
	if f.recorded == nil {
		f.recorded = map[string]string{}
		f.weeks = map[string]string{}
	}
	f.recorded[userID] = failure
	f.weeks[userID] = week
	return nil
}

func doRecap(s *recapService, authorization string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, WeeklyRecapPath, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	s.send(rec, req)
	return rec
}

func TestWeeklyRecapNeedsTheCronSecret(t *testing.T) {
	mailer := &fakeMailer{enabled: true}
	s := newRecapService(&fakeRecapBackend{}, mailer, testLogger(), "s3cret", "")
	if rec := doRecap(s, "Bearer wrong"); rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d", rec.Code)
	}
	if rec := doRecap(newRecapService(nil, mailer, testLogger(), "", ""), "Bearer x"); rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("without a secret: status = %d", rec.Code)
	}
	if len(mailer.sent) != 0 {
		t.Fatal("mail was sent without authorization")
	}
}

func TestWeeklyRecapSendsEachPlayerTheirWeekOnce(t *testing.T) {
	backend := &fakeRecapBackend{pending: []supabasedigest.RecapRecipient{
		{UserID: "u1", WeekStart: "2026-11-09", Email: "ana@example.com", DisplayName: "Ana", Language: "en",
			GamesPlayed: 9, GamesDistinct: 3, TopGameSlug: "sudoku", TopGameTitle: "Sudoku",
			NewBests: 2, PassedBy: 1, Streak: 5},
		// Already into next week on their clock: their own week keys their recap.
		{UserID: "u2", WeekStart: "2026-11-16", Email: "beni@example.com", DisplayName: "Beni", Language: "sq"},
	}}
	mailer := &fakeMailer{enabled: true}
	s := newRecapService(backend, mailer, testLogger(), "s3cret", "https://unbored.lol")

	if rec := doRecap(s, "Bearer s3cret"); rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if len(mailer.sent) != 2 {
		t.Fatalf("sent %d emails", len(mailer.sent))
	}

	ana := mailer.sent[0]
	if ana.Subject != "Your week on Unbored: 9 games" ||
		ana.IdempotencyKey != "weekly-recap/2026-11-09/u1" {
		t.Errorf("ana = %q, %q", ana.Subject, ana.IdempotencyKey)
	}
	for _, want := range []string{
		"Hi Ana,", "You played 9 games this week, across 3 different ones.",
		"Your favourite was Sudoku.", "You set 2 new personal bests.",
		"A friend beat one of your scores.", "5-day streak",
		"https://unbored.lol/play/sudoku", "https://unbored.lol/settings/notifications",
	} {
		if !strings.Contains(ana.Text, want) {
			t.Errorf("ana's text has no %q:\n%s", want, ana.Text)
		}
	}

	beni := mailer.sent[1]
	if beni.Subject != "Lojërat të kanë mall" || !strings.Contains(beni.Text, "Këtë javë nuk luajte.") {
		t.Errorf("a quiet week in Albanian = %q\n%s", beni.Subject, beni.Text)
	}
	if beni.IdempotencyKey != "weekly-recap/2026-11-16/u2" || backend.weeks["u2"] != "2026-11-16" {
		t.Errorf("beni's week = %q, recorded %q", beni.IdempotencyKey, backend.weeks["u2"])
	}

	// Everyone recorded: the next run has nobody left.
	mailer.sent = nil
	doRecap(s, "Bearer s3cret")
	if len(mailer.sent) != 0 {
		t.Fatalf("a second run sent %d more", len(mailer.sent))
	}
}

func TestWeeklyRecapRecordsAFailedSend(t *testing.T) {
	backend := &fakeRecapBackend{pending: []supabasedigest.RecapRecipient{
		{UserID: "u1", WeekStart: "2026-11-09", Email: "ana@example.com", Language: "en"},
	}}
	mailer := &fakeMailer{enabled: true, err: errors.New("bounced")}
	doRecap(newRecapService(backend, mailer, testLogger(), "s3cret", ""), "Bearer s3cret")
	if backend.recorded["u1"] != "delivery failed" {
		t.Fatalf("recorded = %v", backend.recorded)
	}
}

func TestWeeklyRecapGreetsWithoutAName(t *testing.T) {
	content := renderRecap(supabasedigest.RecapRecipient{Language: "en"}, "https://unbored.lol")
	if !strings.HasPrefix(content.Text, "Hi,\n") {
		t.Errorf("greeting = %q", strings.SplitN(content.Text, "\n", 2)[0])
	}
}
