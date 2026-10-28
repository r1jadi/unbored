// Package notifications owns the game-release digest.
//
// Once five games have been published since the last digest, the database
// returns those games and the accounts that explicitly opted in to "occasional
// emails about new games". This package renders one email with each game's name,
// how-to-play text and link, sends it through Resend, and records every outcome so
// a retry does not mail anyone twice.
//
// The endpoint is not a user route: it is called by Vercel Cron and authenticated
// with CRON_SECRET, which Vercel sends as `Authorization: Bearer …`. Without the
// secret the route answers 503 rather than becoming an open mail trigger.
package notifications

import (
	"context"
	"crypto/subtle"
	"fmt"
	"html/template"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/internal/email"
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

// Name is the service name used in logs and configuration validation.
const Name = "notifications"

// DigestPath is the machine-triggered route Vercel Cron calls. It lives under
// /api/v1/cron, a prefix the gateway forwards to the games deployment, because
// that deployment holds the secret key and the admin bridge already there.
const DigestPath = "/api/v1/cron/game-digests"

const (
	// recipientBatch is how many recipients one RPC returns. The handler repeats
	// until a batch is empty or the per-run cap is reached.
	recipientBatch = 25
	// maxRecipientsPerRun keeps one cron invocation inside the server's 30-second
	// write budget. A larger audience finishes over the following daily runs;
	// every successful send is recorded, so no one is mailed twice.
	maxRecipientsPerRun = 25
	// defaultSiteURL is where a digest's play links point when PUBLIC_SITE_URL is
	// not configured. It is the production origin, not a placeholder.
	defaultSiteURL = "https://unbored.lol"
)

// Backend is the database surface the digest needs.
type Backend interface {
	Claim(ctx context.Context) (digestID string, found bool, err error)
	Games(ctx context.Context, digestID string) ([]supabasedigest.Game, error)
	Recipients(ctx context.Context, digestID string, limit int) ([]supabasedigest.Recipient, error)
	Record(ctx context.Context, digestID, userID, failure string) error
	Close(ctx context.Context, digestID string) (bool, error)
}

// Mailer is the one method the handler needs from a Resend sender.
type Mailer interface {
	Configured() bool
	Send(ctx context.Context, msg email.Message) (string, error)
}

type service struct {
	backend Backend
	mailer  Mailer
	logger  *slog.Logger
	secret  string
	siteURL string
}

func newService(backend Backend, mailer Mailer, logger *slog.Logger, secret, siteURL string) *service {
	if logger == nil {
		logger = slog.Default()
	}
	return &service{
		backend: backend,
		mailer:  mailer,
		logger:  logger,
		secret:  strings.TrimSpace(secret),
		siteURL: normalizeSiteURL(siteURL),
	}
}

func (s *service) register(router *httpx.Router) {
	router.PublicFunc("GET "+DigestPath, s.sendDigest)
}

// sendDigest sends at most one digest per invocation. It answers `idle` while
// fewer than five games are waiting, and reports how many messages were sent or
// failed.
func (s *service) sendDigest(w http.ResponseWriter, r *http.Request) {
	if s.secret == "" {
		s.logger.WarnContext(r.Context(), "CRON_SECRET is not set; the digest route is disabled")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
			"Game digests are not available right now."))
		return
	}
	if !sameSecret(r.Header.Get("Authorization"), "Bearer "+s.secret) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized,
			"Authentication required."))
		return
	}
	if s.backend == nil {
		s.logger.WarnContext(r.Context(), "the digest database is not configured")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
			"Game digests are not available right now."))
		return
	}
	if s.mailer == nil || !s.mailer.Configured() {
		s.logger.WarnContext(r.Context(), "RESEND_API_KEY or EMAIL_FROM is not set; the digest cannot send")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
			"Game digests are not available right now."))
		return
	}

	digestID, found, err := s.backend.Claim(r.Context())
	if err != nil {
		s.logger.ErrorContext(r.Context(), "claiming a game digest failed",
			slog.Any("error", err))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
			"Game digests are not available right now."))
		return
	}
	if !found {
		httpx.WriteJSON(w, r, http.StatusOK, digestResponse{Status: "idle"})
		return
	}

	games, err := s.backend.Games(r.Context(), digestID)
	if err != nil {
		s.logger.ErrorContext(r.Context(), "reading a game digest failed",
			slog.String("digest_id", digestID), slog.Any("error", err))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
			"Game digests are not available right now."))
		return
	}
	if len(games) == 0 {
		// Every game in the batch was archived before sending. Close it rather
		// than leave the queue stuck behind an empty email.
		if _, err := s.backend.Close(r.Context(), digestID); err != nil {
			s.logger.ErrorContext(r.Context(), "closing an empty game digest failed",
				slog.String("digest_id", digestID), slog.Any("error", err))
		}
		httpx.WriteJSON(w, r, http.StatusOK, digestResponse{Status: "idle", DigestID: digestID})
		return
	}

	content, err := renderDigest(games, s.siteURL)
	if err != nil {
		s.logger.ErrorContext(r.Context(), "rendering a game digest failed",
			slog.String("digest_id", digestID), slog.Any("error", err))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeInternal,
			"Something went wrong on our side."))
		return
	}

	response := digestResponse{Status: "sent", DigestID: digestID, Games: len(games)}
	for response.Sent+response.Failed < maxRecipientsPerRun {
		recipients, err := s.backend.Recipients(r.Context(), digestID, recipientBatch)
		if err != nil {
			s.logger.ErrorContext(r.Context(), "reading digest recipients failed",
				slog.String("digest_id", digestID), slog.Any("error", err))
			break
		}
		if len(recipients) == 0 {
			break
		}
		for _, recipient := range recipients {
			_, sendErr := s.mailer.Send(r.Context(), email.Message{
				To:             []string{recipient.Email},
				Subject:        content.Subject,
				HTML:           content.HTML,
				Text:           content.Text,
				IdempotencyKey: "game-digest/" + digestID + "/" + recipient.UserID,
			})
			failure := ""
			if sendErr != nil {
				failure = "delivery failed"
				response.Failed++
				s.logger.WarnContext(r.Context(), "a game digest email failed",
					slog.String("digest_id", digestID),
					slog.String("user_id", recipient.UserID),
					slog.Any("error", sendErr))
			} else {
				response.Sent++
			}
			if err := s.backend.Record(r.Context(), digestID, recipient.UserID, failure); err != nil {
				// The message may have been delivered; the idempotency key keeps
				// a later retry from sending it twice within Resend's window.
				s.logger.ErrorContext(r.Context(), "recording a digest delivery failed",
					slog.String("digest_id", digestID),
					slog.String("user_id", recipient.UserID),
					slog.Any("error", err))
			}
			if response.Sent+response.Failed >= maxRecipientsPerRun {
				break
			}
		}
	}

	closed, err := s.backend.Close(r.Context(), digestID)
	if err != nil {
		s.logger.ErrorContext(r.Context(), "closing a game digest failed",
			slog.String("digest_id", digestID), slog.Any("error", err))
	}
	response.Closed = closed
	httpx.WriteJSON(w, r, http.StatusOK, response)
}

// digestResponse is the cron's own summary. It names no recipient.
type digestResponse struct {
	Status   string `json:"status"`
	DigestID string `json:"digestId,omitempty"`
	Games    int    `json:"games,omitempty"`
	Sent     int    `json:"sent"`
	Failed   int    `json:"failed"`
	Closed   bool   `json:"closed"`
}

// sameSecret compares without leaking length or position through timing.
func sameSecret(got, want string) bool {
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func normalizeSiteURL(raw string) string {
	raw = strings.TrimRight(strings.TrimSpace(raw), "/")
	if raw == "" {
		return defaultSiteURL
	}
	return raw
}

// ── Email content ───────────────────────────────────────────────────────────

type emailGame struct {
	Title        string
	Instructions string
	URL          string
}

type emailContent struct {
	Subject string
	HTML    string
	Text    string
}

type digestTemplateData struct {
	Games       []emailGame
	SettingsURL string
	Count       int
	Intro       string
}

var digestTemplate = template.Must(template.New("game-digest").Parse(`<!doctype html>
<html lang="en">
  <body style="margin:0;padding:0;background:#0d0d10;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
    <div style="max-width:560px;margin:0 auto;padding:32px 24px">
      <p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#a1a1aa">Unbored</p>
      <h1 style="margin:0 0 12px;font-size:28px;line-height:1.2;color:#ffffff">{{if eq .Count 1}}A new game just landed{{else}}{{.Count}} new games just landed{{end}}</h1>
      <p style="margin:0 0 28px;font-size:16px;line-height:1.5;color:#d4d4d8">{{.Intro}}</p>
      {{range .Games}}
      <div style="border-top:1px solid #27272a;padding:20px 0">
        <h2 style="margin:0 0 8px;font-size:20px;line-height:1.3;color:#ffffff">{{.Title}}</h2>
        {{if .Instructions}}<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#d4d4d8;white-space:pre-line">{{.Instructions}}</p>{{else}}<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#d4d4d8">Open it to see how to play.</p>{{end}}
        <a href="{{.URL}}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#a3e635;color:#0d0d10;font-size:14px;font-weight:600;text-decoration:none">Play {{.Title}}</a>
      </div>
      {{end}}
      <p style="margin:28px 0 0;border-top:1px solid #27272a;padding-top:20px;font-size:12px;line-height:1.6;color:#a1a1aa">
        You are receiving this because you opted in to occasional emails about new games.
        <a href="{{.SettingsURL}}" style="color:#a3e635">Manage email preferences</a>.
      </p>
    </div>
  </body>
</html>
`))

func renderDigest(games []supabasedigest.Game, siteURL string) (emailContent, error) {
	items := make([]emailGame, 0, len(games))
	for _, game := range games {
		instructions := ""
		if game.Instructions != nil {
			instructions = strings.TrimSpace(*game.Instructions)
		}
		items = append(items, emailGame{
			Title:        game.Title,
			Instructions: instructions,
			URL:          siteURL + "/play/" + game.Slug,
		})
	}

	intro := fmt.Sprintf("%d games were published since the last update. Here is what is new and how to play.", len(items))
	if len(items) == 1 {
		intro = "A game was published since the last update. Here is what is new and how to play."
	}
	data := digestTemplateData{
		Games:       items,
		SettingsURL: siteURL + "/settings/notifications",
		Count:       len(items),
		Intro:       intro,
	}

	var html strings.Builder
	if err := digestTemplate.Execute(&html, data); err != nil {
		return emailContent{}, fmt.Errorf("render html: %w", err)
	}

	subject := fmt.Sprintf("%d new games just landed on Unbored", len(items))
	if len(items) == 1 {
		subject = "A new game just landed on Unbored"
	}

	var text strings.Builder
	fmt.Fprintf(&text, "%s\n\n%s\n", subject, intro)
	for i, item := range items {
		fmt.Fprintf(&text, "\n%d. %s\n", i+1, item.Title)
		if item.Instructions != "" {
			for _, line := range strings.Split(item.Instructions, "\n") {
				fmt.Fprintf(&text, "   %s\n", line)
			}
		} else {
			text.WriteString("   Open it to see how to play.\n")
		}
		fmt.Fprintf(&text, "   Play: %s\n", item.URL)
	}
	fmt.Fprintf(&text, "\nYou are receiving this because you opted in to occasional emails about new games.\nManage email preferences: %s\n", data.SettingsURL)

	return emailContent{Subject: subject, HTML: html.String(), Text: text.String()}, nil
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Options returns the wiring the games deployment mounts.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, _ *authn.Verifier) {
			var backend Backend
			client, err := supabasedigest.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its
				// probes and answers 503 on the cron route, which is far more
				// diagnosable than a crash loop. The error names no value.
				logger.Warn("the digest database is not configured", slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, email.NewFromEnv(), logger, os.Getenv("CRON_SECRET"), siteURL()).register(router)
		},
	}
}

func siteURL() string {
	for _, key := range []string{"PUBLIC_SITE_URL", "SITE_URL", "VITE_PUBLIC_SITE_URL"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return defaultSiteURL
}
