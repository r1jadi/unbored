package notifications

// The weekly recap: one email per opted-in player about their own week.
//
// The database chooses whose recap is due, on each player's own clock (Sunday from
// 18:00 where they are), and adds up their week (`weekly_recap_due`,
// supabase/migrations/20261229120000_weekly_recap.sql). This sends each one in the
// player's language and records it against that player's week, so nobody gets two.
// pg_cron wakes the route every ten minutes through Sunday and Monday (UTC); each
// run sends at most maxRecipientsPerRun, and the next continues.

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

// WeeklyRecapPath is woken by pg_cron through pg_net (POST), and can be called by a
// scheduler that only knows GET.
const WeeklyRecapPath = "/api/v1/cron/weekly-recap"

// RecapBackend is the database surface the recap needs.
type RecapBackend interface {
	RecapRecipients(ctx context.Context, limit int) ([]supabasedigest.RecapRecipient, error)
	RecordRecap(ctx context.Context, week, userID, failure string) error
}

type recapService struct {
	backend RecapBackend
	mailer  Mailer
	logger  *slog.Logger
	secret  string
	siteURL string
}

func newRecapService(backend RecapBackend, mailer Mailer, logger *slog.Logger, secret, siteURL string) *recapService {
	if logger == nil {
		logger = slog.Default()
	}
	return &recapService{
		backend: backend,
		mailer:  mailer,
		logger:  logger,
		secret:  strings.TrimSpace(secret),
		siteURL: normalizeSiteURL(siteURL),
	}
}

func (s *recapService) register(router *httpx.Router) {
	router.PublicFunc("POST "+WeeklyRecapPath, s.send)
	router.PublicFunc("GET "+WeeklyRecapPath, s.send)
}

// recapResponse is the run's own summary. It names no recipient.
type recapResponse struct {
	Status string `json:"status"`
	Sent   int    `json:"sent"`
	Failed int    `json:"failed"`
}

func (s *recapService) send(w http.ResponseWriter, r *http.Request) {
	if s.secret == "" {
		s.logger.WarnContext(r.Context(), "CRON_SECRET is not set; the weekly recap route is disabled")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The weekly recap is not available right now."))
		return
	}
	if !sameSecret(r.Header.Get("Authorization"), "Bearer "+s.secret) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Authentication required."))
		return
	}
	if s.backend == nil || s.mailer == nil || !s.mailer.Configured() {
		s.logger.WarnContext(r.Context(), "the weekly recap is not configured (database, RESEND_API_KEY or EMAIL_FROM)")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "The weekly recap is not available right now."))
		return
	}

	response := recapResponse{Status: "idle"}
	for response.Sent+response.Failed < maxRecipientsPerRun {
		recipients, err := s.backend.RecapRecipients(r.Context(), recipientBatch)
		if err != nil {
			s.logger.ErrorContext(r.Context(), "reading recap recipients failed", slog.Any("error", err))
			break
		}
		if len(recipients) == 0 {
			break
		}
		response.Status = "sent"
		for _, recipient := range recipients {
			content := renderRecap(recipient, s.siteURL)
			_, sendErr := s.mailer.Send(r.Context(), email.Message{
				To:             []string{recipient.Email},
				Subject:        content.Subject,
				HTML:           content.HTML,
				Text:           content.Text,
				IdempotencyKey: "weekly-recap/" + recipient.WeekStart + "/" + recipient.UserID,
			})
			failure := ""
			if sendErr != nil {
				failure = "delivery failed"
				response.Failed++
				s.logger.WarnContext(r.Context(), "a weekly recap email failed",
					slog.String("user_id", recipient.UserID), slog.Any("error", sendErr))
			} else {
				response.Sent++
			}
			if err := s.backend.RecordRecap(r.Context(), recipient.WeekStart, recipient.UserID, failure); err != nil {
				// The idempotency key keeps a retry from sending it twice.
				s.logger.ErrorContext(r.Context(), "recording a recap delivery failed",
					slog.String("user_id", recipient.UserID), slog.Any("error", err))
			}
			if response.Sent+response.Failed >= maxRecipientsPerRun {
				break
			}
		}
	}
	httpx.WriteJSON(w, r, http.StatusOK, response)
}

// ── Email content ───────────────────────────────────────────────────────────

type recapCopy struct {
	subjectPlayed, subjectQuiet       string
	greeting                          string
	playedLine                        string // %[1]d games, %[2]d different
	topLine                           string // %[1]s game
	bestsOne, bestsMany               string // %[1]d
	passedOne, passedMany             string // %[1]d
	streakLine                        string // %[1]d days
	quietLine                         string
	playCTA, settingsText, footerText string
}

var recapCopies = map[string]recapCopy{
	"en": {
		subjectPlayed: "Your week on Unbored: %[1]d games",
		subjectQuiet:  "Your games miss you",
		greeting:      "Hi %[1]s,",
		playedLine:    "You played %[1]d games this week, across %[2]d different ones.",
		topLine:       "Your favourite was %[1]s.",
		bestsOne:      "You set a new personal best.",
		bestsMany:     "You set %[1]d new personal bests.",
		passedOne:     "A friend beat one of your scores. Time to take it back?",
		passedMany:    "%[1]d friends beat your scores. Time to take them back?",
		streakLine:    "You're on a %[1]d-day streak. One game a day keeps it going.",
		quietLine:     "You didn't play this week. A new daily puzzle is waiting, and it takes a minute.",
		playCTA:       "Play now",
		settingsText:  "Turn off weekly recaps",
		footerText:    "You get this because you turned on weekly recaps in Unbored.",
	},
	"sq": {
		subjectPlayed: "Java jote në Unbored: %[1]d lojëra",
		subjectQuiet:  "Lojërat të kanë mall",
		greeting:      "Përshëndetje %[1]s,",
		playedLine:    "Këtë javë luajte %[1]d lojëra, nga %[2]d të ndryshme.",
		topLine:       "E preferuara jote ishte %[1]s.",
		bestsOne:      "Vendose një rekord të ri personal.",
		bestsMany:     "Vendose %[1]d rekorde të reja personale.",
		passedOne:     "Një shok të kaloi një rezultat. Kohë ta marrësh mbrapsht?",
		passedMany:    "%[1]d shokë të kaluan rezultatet. Kohë t'i marrësh mbrapsht?",
		streakLine:    "Je në një seri prej %[1]d ditësh. Një lojë në ditë e mban.",
		quietLine:     "Këtë javë nuk luajte. Të pret një enigmë e re ditore, dhe zgjat një minutë.",
		playCTA:       "Luaj tani",
		settingsText:  "Çaktivizo përmbledhjet javore",
		footerText:    "E merr këtë sepse aktivizove përmbledhjet javore në Unbored.",
	},
}

type recapTemplateData struct {
	Greeting     string
	Lines        []string
	PlayURL      string
	PlayCTA      string
	SettingsURL  string
	SettingsText string
	Footer       string
}

var recapTemplate = template.Must(template.New("weekly-recap").Parse(`<!doctype html>
<html><body style="margin:0;background:#16171b;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#f4f4f6">
<div style="max-width:520px;margin:0 auto;padding:32px 24px">
<p style="font-size:20px;font-weight:600;margin:0 0 16px">{{.Greeting}}</p>
{{range .Lines}}<p style="font-size:16px;line-height:1.5;margin:0 0 12px">{{.}}</p>
{{end}}<p style="margin:24px 0"><a href="{{.PlayURL}}" style="display:inline-block;background:#f27a3d;color:#16171b;font-weight:600;text-decoration:none;padding:12px 20px;border-radius:10px">{{.PlayCTA}}</a></p>
<p style="font-size:12px;color:#9a9ba3;margin:32px 0 0">{{.Footer}} <a href="{{.SettingsURL}}" style="color:#9a9ba3">{{.SettingsText}}</a></p>
</div></body></html>`))

// renderRecap words one player's week in their language.
func renderRecap(recipient supabasedigest.RecapRecipient, siteURL string) emailContent {
	words, ok := recapCopies[recipient.Language]
	if !ok {
		words = recapCopies["en"]
	}
	name := strings.TrimSpace(recipient.DisplayName)

	var lines []string
	subject := words.subjectQuiet
	playURL := siteURL + "/"
	if recipient.GamesPlayed > 0 {
		subject = fmt.Sprintf(words.subjectPlayed, recipient.GamesPlayed)
		lines = append(lines, fmt.Sprintf(words.playedLine, recipient.GamesPlayed, recipient.GamesDistinct))
		if recipient.TopGameTitle != "" {
			lines = append(lines, fmt.Sprintf(words.topLine, recipient.TopGameTitle))
			playURL = siteURL + "/play/" + recipient.TopGameSlug
		}
		switch {
		case recipient.NewBests == 1:
			lines = append(lines, words.bestsOne)
		case recipient.NewBests > 1:
			lines = append(lines, fmt.Sprintf(words.bestsMany, recipient.NewBests))
		}
	} else {
		lines = append(lines, words.quietLine)
	}
	switch {
	case recipient.PassedBy == 1:
		lines = append(lines, words.passedOne)
	case recipient.PassedBy > 1:
		lines = append(lines, fmt.Sprintf(words.passedMany, recipient.PassedBy))
	}
	if recipient.Streak >= 2 {
		lines = append(lines, fmt.Sprintf(words.streakLine, recipient.Streak))
	}

	// "Hi Ana," or, with no name to use, just "Hi,".
	greeting := strings.Replace(words.greeting, " %[1]s", "", 1)
	if name != "" {
		greeting = fmt.Sprintf(words.greeting, name)
	}
	data := recapTemplateData{
		Greeting:     greeting,
		Lines:        lines,
		PlayURL:      playURL,
		PlayCTA:      words.playCTA,
		SettingsURL:  siteURL + "/settings/notifications",
		SettingsText: words.settingsText,
		Footer:       words.footerText,
	}
	var html strings.Builder
	if err := recapTemplate.Execute(&html, data); err != nil {
		// The template is fixed and its data is strings; this cannot fail in practice.
		html.Reset()
	}
	text := greeting + "\n\n" + strings.Join(lines, "\n") + "\n\n" + words.playCTA + ": " + playURL +
		"\n\n" + words.footerText + "\n" + words.settingsText + ": " + data.SettingsURL + "\n"
	return emailContent{Subject: subject, HTML: html.String(), Text: text}
}
