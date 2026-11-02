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

type fakeFeedback struct {
	pending []supabasedigest.Feedback
	err     error
	marked  []string
}

func (f *fakeFeedback) PendingFeedback(context.Context, int) ([]supabasedigest.Feedback, error) {
	return f.pending, f.err
}

func (f *fakeFeedback) MarkFeedbackEmailed(_ context.Context, id string) error {
	f.marked = append(f.marked, id)
	return nil
}

func testFeedback() []supabasedigest.Feedback {
	return []supabasedigest.Feedback{
		{
			ID: "11111111-1111-4111-8111-111111111111", Mood: 4, Category: "idea",
			Message: "Add a <b>dark</b> mode", Context: "390x844 · Mobile Safari",
			SenderUsername: "nora", SenderEmail: "nora@example.com", CreatedAt: "2026-11-27T10:00:00Z",
		},
		{
			ID: "22222222-2222-4222-8222-222222222222", Mood: 1, Category: "bug",
			Message: "The feed jumps", SenderUsername: "sam", CreatedAt: "2026-11-27T10:05:00Z",
		},
	}
}

func TestFlushMailsEachPendingRowToTheTeamAndStampsIt(t *testing.T) {
	backend := &fakeFeedback{pending: testFeedback()}
	mailer := &fakeMailer{enabled: true}
	s := newFeedbackService(backend, mailer, testLogger(), "secret", "")

	sent, failed, err := s.flush(context.Background())
	if err != nil || sent != 2 || failed != 0 {
		t.Fatalf("flush = %d sent, %d failed, %v; want 2, 0, nil", sent, failed, err)
	}
	if len(mailer.sent) != 2 {
		t.Fatalf("mailed %d messages, want 2", len(mailer.sent))
	}
	first := mailer.sent[0]
	if len(first.To) != 1 || first.To[0] != "contactunbored@gmail.com" {
		t.Errorf("To = %v, want the team inbox", first.To)
	}
	if first.ReplyTo != "nora@example.com" {
		t.Errorf("ReplyTo = %q, want the sender so a reply reaches them", first.ReplyTo)
	}
	if mailer.sent[1].ReplyTo != "" {
		t.Errorf("ReplyTo = %q, want none when the sender has no address", mailer.sent[1].ReplyTo)
	}
	if first.IdempotencyKey != "feedback/11111111-1111-4111-8111-111111111111" {
		t.Errorf("IdempotencyKey = %q", first.IdempotencyKey)
	}
	if !strings.Contains(first.Subject, "Idea") || !strings.Contains(first.Subject, "@nora") {
		t.Errorf("Subject = %q", first.Subject)
	}
	if strings.Contains(first.HTML, "<b>dark</b>") || !strings.Contains(first.HTML, "&lt;b&gt;dark&lt;/b&gt;") {
		t.Errorf("the message must be HTML-escaped: %s", first.HTML)
	}
	if !strings.Contains(first.Text, "Add a <b>dark</b> mode") || !strings.Contains(first.Text, "390x844") {
		t.Errorf("the text part is missing the message or device: %s", first.Text)
	}
	if len(backend.marked) != 2 {
		t.Errorf("stamped %v, want both rows", backend.marked)
	}
}

func TestFlushUsesTheConfiguredRecipient(t *testing.T) {
	backend := &fakeFeedback{pending: testFeedback()[:1]}
	mailer := &fakeMailer{enabled: true}
	s := newFeedbackService(backend, mailer, testLogger(), "secret", " team@example.com ")

	if _, _, err := s.flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if mailer.sent[0].To[0] != "team@example.com" {
		t.Errorf("To = %v, want the configured recipient", mailer.sent[0].To)
	}
}

func TestFlushLeavesAFailedRowPendingForTheNextRun(t *testing.T) {
	backend := &fakeFeedback{pending: testFeedback()}
	mailer := &fakeMailer{enabled: true, err: errors.New("resend down")}
	s := newFeedbackService(backend, mailer, testLogger(), "secret", "")

	sent, failed, err := s.flush(context.Background())
	if err != nil || sent != 0 || failed != 2 {
		t.Fatalf("flush = %d sent, %d failed, %v; want 0, 2, nil", sent, failed, err)
	}
	if len(backend.marked) != 0 {
		t.Errorf("stamped %v, want none: a row is stamped only after the mail was accepted", backend.marked)
	}
}

func doFeedbackCron(s *feedbackService, authorization string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, FeedbackCronPath, nil)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	rec := httptest.NewRecorder()
	s.cron(rec, req)
	return rec
}

func TestFeedbackCronNeedsTheSecret(t *testing.T) {
	backend := &fakeFeedback{pending: testFeedback()}
	mailer := &fakeMailer{enabled: true}

	unset := newFeedbackService(backend, mailer, testLogger(), "", "")
	if rec := doFeedbackCron(unset, "Bearer "); rec.Code != http.StatusServiceUnavailable {
		t.Errorf("no CRON_SECRET: status = %d, want 503", rec.Code)
	}

	s := newFeedbackService(backend, mailer, testLogger(), "secret", "")
	if rec := doFeedbackCron(s, ""); rec.Code != http.StatusUnauthorized {
		t.Errorf("no header: status = %d, want 401", rec.Code)
	}
	if rec := doFeedbackCron(s, "Bearer wrong"); rec.Code != http.StatusUnauthorized {
		t.Errorf("wrong secret: status = %d, want 401", rec.Code)
	}
	if len(mailer.sent) != 0 {
		t.Fatal("a refused request sent mail")
	}

	rec := doFeedbackCron(s, "Bearer secret")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"sent":2`) {
		t.Errorf("authorised: status = %d body = %s", rec.Code, rec.Body.String())
	}
}

func TestFeedbackNotifyAnswersUnavailableWithoutMailConfig(t *testing.T) {
	backend := &fakeFeedback{pending: testFeedback()}
	s := newFeedbackService(backend, &fakeMailer{enabled: false}, testLogger(), "secret", "")

	rec := httptest.NewRecorder()
	s.notify(rec, httptest.NewRequest(http.MethodPost, FeedbackNotifyPath, nil))
	if rec.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 while RESEND_API_KEY / EMAIL_FROM are unset", rec.Code)
	}
}
