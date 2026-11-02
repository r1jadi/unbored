package notifications

import (
	"context"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/email"
	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

// Feedback reaches the team by email as well as the admin console.
//
// A player's feedback is stored by the browser (`public.feedback`, row-level
// security). This file mails each stored row to the team's inbox, once: the
// database keeps an outbox (`feedback.emailed_at`), a row is stamped only after
// Resend accepted it, and a Resend idempotency key per row keeps a retry from
// sending a second copy.
//
// Two doors lead here, and both run the same flush:
//
//   - FeedbackNotifyPath, called by the browser right after a player sends
//     feedback. It needs a signed-in caller, mails at most a handful of unsent
//     rows and ignores the request body, so it cannot be used to send anything
//     the database does not hold.
//   - FeedbackCronPath, Vercel Cron with CRON_SECRET, a daily safety net for a
//     row whose notify call never arrived.
const (
	// FeedbackNotifyPath lives under /api/v1/cron, the prefix the gateway already
	// forwards to the games deployment (see services/internal/apiroutes).
	FeedbackNotifyPath = "/api/v1/cron/feedback-notify"
	FeedbackCronPath   = "/api/v1/cron/feedback-emails"

	// feedbackBatch bounds one flush, inside the service's request budget.
	feedbackBatch = 10

	// DefaultFeedbackTo is where feedback is mailed unless FEEDBACK_EMAIL_TO says
	// otherwise.
	DefaultFeedbackTo = "contactunbored@gmail.com"
)

// FeedbackBackend is the database surface the feedback outbox needs.
type FeedbackBackend interface {
	PendingFeedback(ctx context.Context, limit int) ([]supabasedigest.Feedback, error)
	MarkFeedbackEmailed(ctx context.Context, id string) error
}

type feedbackService struct {
	backend FeedbackBackend
	mailer  Mailer
	logger  *slog.Logger
	secret  string
	to      string
}

func newFeedbackService(backend FeedbackBackend, mailer Mailer, logger *slog.Logger, secret, to string) *feedbackService {
	if logger == nil {
		logger = slog.Default()
	}
	to = strings.TrimSpace(to)
	if to == "" {
		to = DefaultFeedbackTo
	}
	return &feedbackService{
		backend: backend,
		mailer:  mailer,
		logger:  logger,
		secret:  strings.TrimSpace(secret),
		to:      to,
	}
}

func (s *feedbackService) register(router *httpx.Router) {
	router.AuthenticatedFunc("POST "+FeedbackNotifyPath, s.notify)
	router.PublicFunc("GET "+FeedbackCronPath, s.cron)
}

// notify flushes the outbox for a signed-in caller.
func (s *feedbackService) notify(w http.ResponseWriter, r *http.Request) {
	s.flushAndRespond(w, r)
}

// cron flushes the outbox for Vercel Cron.
func (s *feedbackService) cron(w http.ResponseWriter, r *http.Request) {
	if s.secret == "" {
		s.logger.WarnContext(r.Context(), "CRON_SECRET is not set; the feedback cron route is disabled")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Feedback email is not available right now."))
		return
	}
	if !sameSecret(r.Header.Get("Authorization"), "Bearer "+s.secret) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Authentication required."))
		return
	}
	s.flushAndRespond(w, r)
}

func (s *feedbackService) flushAndRespond(w http.ResponseWriter, r *http.Request) {
	if s.backend == nil || s.mailer == nil || !s.mailer.Configured() {
		s.logger.WarnContext(r.Context(), "feedback email is not configured (database, RESEND_API_KEY or EMAIL_FROM)")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Feedback email is not available right now."))
		return
	}
	sent, failed, err := s.flush(r.Context())
	if err != nil {
		s.logger.ErrorContext(r.Context(), "reading pending feedback failed", slog.Any("error", err))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Feedback email is not available right now."))
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, feedbackResponse{Sent: sent, Failed: failed})
}

// feedbackResponse is a summary that names no sender and quotes no message.
type feedbackResponse struct {
	Sent   int `json:"sent"`
	Failed int `json:"failed"`
}

// flush mails every pending row, oldest first, up to the batch size. A row is
// stamped only once Resend accepted it; one that fails stays pending for the
// next flush.
func (s *feedbackService) flush(ctx context.Context) (sent, failed int, err error) {
	rows, err := s.backend.PendingFeedback(ctx, feedbackBatch)
	if err != nil {
		return 0, 0, err
	}
	for _, row := range rows {
		content, renderErr := renderFeedback(row)
		if renderErr != nil {
			failed++
			s.logger.ErrorContext(ctx, "rendering feedback email failed",
				slog.String("feedback_id", row.ID), slog.Any("error", renderErr))
			continue
		}
		msg := email.Message{
			To:             []string{s.to},
			Subject:        content.Subject,
			HTML:           content.HTML,
			Text:           content.Text,
			IdempotencyKey: "feedback/" + row.ID,
		}
		// Replying to the notification answers the player.
		if strings.Contains(row.SenderEmail, "@") {
			msg.ReplyTo = row.SenderEmail
		}
		if _, sendErr := s.mailer.Send(ctx, msg); sendErr != nil {
			failed++
			s.logger.WarnContext(ctx, "a feedback email failed",
				slog.String("feedback_id", row.ID), slog.Any("error", sendErr))
			continue
		}
		sent++
		if markErr := s.backend.MarkFeedbackEmailed(ctx, row.ID); markErr != nil {
			// The mail went out; the idempotency key keeps a later retry from
			// sending it twice within Resend's window.
			s.logger.ErrorContext(ctx, "marking feedback emailed failed",
				slog.String("feedback_id", row.ID), slog.Any("error", markErr))
		}
	}
	return sent, failed, nil
}

// ── Email content ───────────────────────────────────────────────────────────

var feedbackMoods = map[int]string{1: "Rough", 2: "Meh", 3: "Okay", 4: "Good", 5: "Love it"}

var feedbackCategories = map[string]string{
	"idea":   "Idea",
	"bug":    "Something broke",
	"praise": "Kind words",
	"other":  "Something else",
}

type feedbackTemplateData struct {
	Mood     string
	Category string
	Username string
	Email    string
	Message  string
	Context  string
	Sent     string
}

var feedbackTemplate = template.Must(template.New("feedback").Parse(`<!doctype html>
<html lang="en">
  <body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
    <p style="margin:0 0 4px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#71717a">Unbored feedback</p>
    <h1 style="margin:0 0 16px;font-size:20px">{{.Category}} · {{.Mood}}</h1>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;white-space:pre-wrap">{{.Message}}</p>
    <table style="font-size:13px;color:#52525b;border-collapse:collapse">
      <tr><td style="padding:2px 12px 2px 0">From</td><td>@{{.Username}}{{if .Email}} &lt;{{.Email}}&gt;{{end}}</td></tr>
      <tr><td style="padding:2px 12px 2px 0">Sent</td><td>{{.Sent}}</td></tr>
      {{if .Context}}<tr><td style="padding:2px 12px 2px 0">Device</td><td>{{.Context}}</td></tr>{{end}}
    </table>
    <p style="margin:20px 0 0;font-size:12px;color:#71717a">Reply to this email to answer the player. All feedback is also in the admin console under Feedback.</p>
  </body>
</html>
`))

func renderFeedback(row supabasedigest.Feedback) (emailContent, error) {
	mood := feedbackMoods[row.Mood]
	if mood == "" {
		mood = fmt.Sprintf("Mood %d", row.Mood)
	}
	category := feedbackCategories[row.Category]
	if category == "" {
		category = "Feedback"
	}
	data := feedbackTemplateData{
		Mood:     mood,
		Category: category,
		Username: row.SenderUsername,
		Email:    row.SenderEmail,
		Message:  row.Message,
		Context:  row.Context,
		Sent:     row.CreatedAt,
	}
	var html strings.Builder
	if err := feedbackTemplate.Execute(&html, data); err != nil {
		return emailContent{}, fmt.Errorf("render html: %w", err)
	}

	subject := fmt.Sprintf("[Unbored feedback] %s · %s from @%s", category, mood, row.SenderUsername)
	var text strings.Builder
	fmt.Fprintf(&text, "%s\n\n%s\n\nFrom: @%s", subject, row.Message, row.SenderUsername)
	if row.SenderEmail != "" {
		fmt.Fprintf(&text, " <%s>", row.SenderEmail)
	}
	fmt.Fprintf(&text, "\nSent: %s\n", row.CreatedAt)
	if row.Context != "" {
		fmt.Fprintf(&text, "Device: %s\n", row.Context)
	}
	return emailContent{Subject: subject, HTML: html.String(), Text: text.String()}, nil
}
