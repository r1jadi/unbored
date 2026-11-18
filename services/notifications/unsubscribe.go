package notifications

// One-click unsubscribe for marketing email (CAN-SPAM, RFC 8058).
//
// Every digest and weekly recap carries a link signed for one account and one
// email kind, plus List-Unsubscribe / List-Unsubscribe-Post headers so mail
// apps can show their own "Unsubscribe" button. Opening the link shows a
// confirmation page (a GET never changes anything, so link scanners cannot
// unsubscribe anyone); its button, or a mail app's one-click POST, turns the
// preference off. No sign-in is needed, and the link never expires, so an
// opt-out keeps working long after the email was sent.
//
// The signing key is derived from CRON_SECRET, which the sending process
// already holds, so no new secret has to be configured.

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"html/template"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/httpx"
)

// UnsubscribePath is the public route the links in marketing emails point at.
const UnsubscribePath = "/api/v1/email/unsubscribe"

const (
	kindNewGames    = "new-games"
	kindWeeklyRecap = "weekly-recap"
	// defaultAPIURL is where unsubscribe links point when PUBLIC_API_URL is not
	// configured. It is the production API origin.
	defaultAPIURL = "https://api.unbored.lol"
)

// Unsubscriber turns one email kind off for one account.
type Unsubscriber interface {
	Unsubscribe(ctx context.Context, userID, kind string) error
}

// unsubscribeSigner signs and verifies unsubscribe tokens.
type unsubscribeSigner struct {
	key    []byte
	apiURL string
}

func newUnsubscribeSigner(secret, apiURL string) *unsubscribeSigner {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte("unbored/email-unsubscribe/v1"))
	apiURL = strings.TrimRight(strings.TrimSpace(apiURL), "/")
	if apiURL == "" {
		apiURL = defaultAPIURL
	}
	return &unsubscribeSigner{key: mac.Sum(nil), apiURL: apiURL}
}

func (s *unsubscribeSigner) signature(userID, kind string) string {
	mac := hmac.New(sha256.New, s.key)
	mac.Write([]byte(kind + "\n" + userID))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// URL is the unsubscribe link for one account and one email kind.
func (s *unsubscribeSigner) URL(userID, kind string) string {
	query := url.Values{"u": {userID}, "k": {kind}, "s": {s.signature(userID, kind)}}
	return s.apiURL + UnsubscribePath + "?" + query.Encode()
}

// Headers are the RFC 8058 headers for one message.
func (s *unsubscribeSigner) Headers(userID, kind string) map[string]string {
	return map[string]string{
		"List-Unsubscribe":      "<" + s.URL(userID, kind) + ">",
		"List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
	}
}

func (s *unsubscribeSigner) verify(userID, kind, signature string) bool {
	if userID == "" || (kind != kindNewGames && kind != kindWeeklyRecap) {
		return false
	}
	return hmac.Equal([]byte(signature), []byte(s.signature(userID, kind)))
}

// postalAddress is the sender's physical postal address, which CAN-SPAM
// requires in every commercial email. Marketing email is not sent without it.
func postalAddress() string {
	return strings.TrimSpace(os.Getenv("EMAIL_POSTAL_ADDRESS"))
}

func apiURL() string {
	for _, key := range []string{"PUBLIC_API_URL", "API_ORIGIN"} {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return defaultAPIURL
}

type unsubscribeService struct {
	backend Unsubscriber
	signer  *unsubscribeSigner
	logger  *slog.Logger
	siteURL string
}

func newUnsubscribeService(backend Unsubscriber, signer *unsubscribeSigner, logger *slog.Logger, siteURL string) *unsubscribeService {
	if logger == nil {
		logger = slog.Default()
	}
	return &unsubscribeService{backend: backend, signer: signer, logger: logger, siteURL: normalizeSiteURL(siteURL)}
}

func (s *unsubscribeService) register(router *httpx.Router) {
	router.PublicFunc("GET "+UnsubscribePath, s.confirm)
	router.PublicFunc("POST "+UnsubscribePath, s.unsubscribe)
}

func (s *unsubscribeService) params(r *http.Request) (userID, kind string, ok bool) {
	query := r.URL.Query()
	userID, kind = query.Get("u"), query.Get("k")
	return userID, kind, s.signer != nil && s.signer.verify(userID, kind, query.Get("s"))
}

// confirm shows the page with the unsubscribe button. It changes nothing.
func (s *unsubscribeService) confirm(w http.ResponseWriter, r *http.Request) {
	_, kind, ok := s.params(r)
	if !ok {
		s.page(w, http.StatusBadRequest, unsubscribePage{
			Title:   "This link doesn't work",
			Message: "It may have been copied incompletely. You can turn emails off in Settings → Notifications.",
			Site:    s.siteURL + "/settings/notifications",
		})
		return
	}
	s.page(w, http.StatusOK, unsubscribePage{
		Title:   "Unsubscribe from " + kindLabel(kind) + "?",
		Message: "You'll stop getting these emails. You can turn them back on in Settings at any time.",
		Action:  r.URL.RequestURI(),
		Site:    s.siteURL + "/settings/notifications",
	})
}

// unsubscribe turns the preference off. It answers both the confirmation
// page's form and a mail app's RFC 8058 one-click POST.
func (s *unsubscribeService) unsubscribe(w http.ResponseWriter, r *http.Request) {
	userID, kind, ok := s.params(r)
	if !ok {
		s.page(w, http.StatusBadRequest, unsubscribePage{
			Title:   "This link doesn't work",
			Message: "It may have been copied incompletely. You can turn emails off in Settings → Notifications.",
			Site:    s.siteURL + "/settings/notifications",
		})
		return
	}
	if s.backend == nil {
		s.logger.WarnContext(r.Context(), "the digest database is not configured; unsubscribe failed")
		s.page(w, http.StatusServiceUnavailable, unsubscribePage{
			Title:   "Something went wrong",
			Message: "We couldn't unsubscribe you just now. Please try the link again in a few minutes.",
			Site:    s.siteURL + "/settings/notifications",
		})
		return
	}
	if err := s.backend.Unsubscribe(r.Context(), userID, kind); err != nil {
		s.logger.ErrorContext(r.Context(), "unsubscribing failed",
			slog.String("user_id", userID), slog.String("kind", kind), slog.Any("error", err))
		s.page(w, http.StatusServiceUnavailable, unsubscribePage{
			Title:   "Something went wrong",
			Message: "We couldn't unsubscribe you just now. Please try the link again in a few minutes.",
			Site:    s.siteURL + "/settings/notifications",
		})
		return
	}
	s.page(w, http.StatusOK, unsubscribePage{
		Title:   "You're unsubscribed",
		Message: "You won't get " + kindLabel(kind) + " any more. You can turn them back on in Settings at any time.",
		Site:    s.siteURL + "/settings/notifications",
	})
}

func kindLabel(kind string) string {
	if kind == kindWeeklyRecap {
		return "weekly recap emails"
	}
	return "new-game emails"
}

type unsubscribePage struct {
	Title, Message, Action, Site string
}

var unsubscribeTemplate = template.Must(template.New("unsubscribe").Parse(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>{{.Title}} · Unbored</title></head>
<body style="margin:0;background:#16171b;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#f4f4f6">
<main style="max-width:480px;margin:0 auto;padding:48px 24px">
<p style="margin:0 0 8px;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;color:#a1a1aa">Unbored</p>
<h1 style="margin:0 0 12px;font-size:24px">{{.Title}}</h1>
<p style="font-size:16px;line-height:1.5;color:#d4d4d8">{{.Message}}</p>
{{if .Action}}<form method="post" action="{{.Action}}" style="margin:24px 0"><button type="submit" style="background:#f27a3d;color:#16171b;font-weight:600;font-size:16px;border:0;padding:12px 20px;border-radius:10px;cursor:pointer">Unsubscribe</button></form>{{end}}
<p style="font-size:14px"><a href="{{.Site}}" style="color:#9a9ba3">Email settings</a></p>
</main></body></html>`))

func (s *unsubscribeService) page(w http.ResponseWriter, status int, data unsubscribePage) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	// The API's default CSP blocks inline styles; this page needs them and a
	// same-origin form post, nothing else.
	w.Header().Set("Content-Security-Policy",
		"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'")
	w.WriteHeader(status)
	_ = unsubscribeTemplate.Execute(w, data)
}
