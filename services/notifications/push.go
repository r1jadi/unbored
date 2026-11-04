package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

// Push delivery: the notifications the database created, sent to the devices that
// opted in.
//
// The database wakes PushDispatchPath whenever a notification is created for
// someone with a subscription (see `wake_push_dispatch`), using CRON_SECRET. The
// request carries nothing: this service reads the outbox itself, so a caller can
// only ever make it send what the database already holds.
const (
	// PushDispatchPath lives under /api/v1/cron, the prefix the gateway already
	// forwards to the games deployment (see services/internal/apiroutes).
	PushDispatchPath = "/api/v1/cron/push-dispatch"

	pushBatch       = 100
	pushMaxBatches  = 3
	pushConcurrency = 8
	pushSendTimeout = 8 * time.Second
	// A day, matching how long the outbox considers a notification worth sending.
	pushTTLSeconds = 24 * 60 * 60
)

// pushEndpoint mirrors `push_subscriptions_endpoint_host`. The database already
// refuses anything else, but this is the line that actually makes the request, so a
// row that reached the table some other way is still never contacted.
var pushEndpoint = regexp.MustCompile(`^https://(fcm\.googleapis\.com|([a-z0-9-]+\.)*push\.apple\.com|([a-z0-9-]+\.)*notify\.windows\.com|([a-z0-9-]+\.)*push\.services\.mozilla\.com)/`)

// PushBackend is the database surface push delivery needs.
type PushBackend interface {
	ClaimPushBatch(ctx context.Context, limit int) ([]supabasedigest.PushDelivery, error)
	DeletePushSubscriptions(ctx context.Context, ids []string) error
}

// PushSender delivers one encrypted message, answering the push service's status.
type PushSender interface {
	Configured() bool
	Send(ctx context.Context, delivery supabasedigest.PushDelivery, message []byte) (int, error)
}

type pushService struct {
	backend PushBackend
	sender  PushSender
	logger  *slog.Logger
	secret  string
}

func newPushService(backend PushBackend, sender PushSender, logger *slog.Logger, secret string) *pushService {
	if logger == nil {
		logger = slog.Default()
	}
	return &pushService{backend: backend, sender: sender, logger: logger, secret: strings.TrimSpace(secret)}
}

func (s *pushService) register(router *httpx.Router) {
	router.PublicFunc("POST "+PushDispatchPath, s.dispatch)
}

// pushResponse is a summary that names no account and holds no endpoint.
type pushResponse struct {
	Sent    int `json:"sent"`
	Failed  int `json:"failed"`
	Expired int `json:"expired"`
}

func (s *pushService) dispatch(w http.ResponseWriter, r *http.Request) {
	if s.secret == "" {
		s.logger.WarnContext(r.Context(), "CRON_SECRET is not set; the push route is disabled")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Push delivery is not available right now."))
		return
	}
	if !sameSecret(r.Header.Get("Authorization"), "Bearer "+s.secret) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Authentication required."))
		return
	}
	// Checked before claiming: a claimed notification is never offered again, so
	// claiming without a way to send would silently lose it.
	if s.backend == nil || s.sender == nil || !s.sender.Configured() {
		s.logger.WarnContext(r.Context(), "push is not configured (database, VAPID_PUBLIC_KEY or VAPID_PRIVATE_KEY)")
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Push delivery is not available right now."))
		return
	}

	var total pushResponse
	for range pushMaxBatches {
		rows, err := s.backend.ClaimPushBatch(r.Context(), pushBatch)
		if err != nil {
			s.logger.ErrorContext(r.Context(), "reading the push outbox failed", slog.Any("error", err))
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Push delivery is not available right now."))
			return
		}
		if len(rows) == 0 {
			break
		}
		result := s.deliver(r.Context(), rows)
		total.Sent += result.Sent
		total.Failed += result.Failed
		total.Expired += result.Expired
	}
	httpx.WriteJSON(w, r, http.StatusOK, total)
}

// deliver sends one batch. A failure to one device never stops the others, and a
// push service saying a subscription is gone removes it.
func (s *pushService) deliver(ctx context.Context, rows []supabasedigest.PushDelivery) pushResponse {
	var (
		mu     sync.Mutex
		wg     sync.WaitGroup
		result pushResponse
		gone   []string
		slots  = make(chan struct{}, pushConcurrency)
	)
	for _, row := range rows {
		message, ok := renderPush(row)
		if !ok || !pushEndpoint.MatchString(row.Endpoint) {
			mu.Lock()
			result.Failed++
			mu.Unlock()
			s.logger.WarnContext(ctx, "skipped an unsendable push", slog.String("kind", row.Kind))
			continue
		}
		wg.Add(1)
		slots <- struct{}{}
		go func() {
			defer wg.Done()
			defer func() { <-slots }()
			sendCtx, cancel := context.WithTimeout(ctx, pushSendTimeout)
			defer cancel()
			status, err := s.sender.Send(sendCtx, row, message)

			mu.Lock()
			defer mu.Unlock()
			switch {
			case err != nil:
				result.Failed++
				// The error names the host at most, never a key or a body.
				s.logger.WarnContext(ctx, "a push could not be sent", slog.Any("error", err))
			case status == http.StatusNotFound || status == http.StatusGone:
				result.Expired++
				gone = append(gone, row.SubscriptionID)
			case status >= 200 && status < 300:
				result.Sent++
			default:
				result.Failed++
				s.logger.WarnContext(ctx, "a push service refused a message", slog.Int("status", status))
			}
		}()
	}
	wg.Wait()

	if len(gone) > 0 {
		if err := s.backend.DeletePushSubscriptions(ctx, gone); err != nil {
			s.logger.WarnContext(ctx, "removing expired push subscriptions failed", slog.Any("error", err))
		}
	}
	return result
}

// pushMessage is what public/sw.js reads to show a notification.
type pushMessage struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

// pushCopy holds the wording for one language. `%[1]s` is the player and `%[2]s` the
// game. It is written here because a service worker has no app to translate with.
type pushCopy struct {
	followTitle, followBody               string
	replyTitle, replyBody                 string
	gameCommentTitle, gameCommentBody     string
	scoreTitle, scoreBody                 string
	messageTitle, messageBody             string
	calloutTitle, calloutBody             string
	calloutResultTitle, calloutResultBody string
	someone                               string
	aGame                                 string
}

var pushCopies = map[string]pushCopy{
	"en": {
		followTitle: "New follower", followBody: "@%[1]s started following you",
		replyTitle: "New reply", replyBody: "@%[1]s replied to your comment on %[2]s",
		gameCommentTitle: "New comment", gameCommentBody: "@%[1]s commented on %[2]s",
		scoreTitle: "Your score was beaten", scoreBody: "@%[1]s beat your score on %[2]s",
		messageTitle: "New message", messageBody: "@%[1]s sent you a message",
		calloutTitle: "You got called out", calloutBody: "@%[1]s called you out on %[2]s",
		calloutResultTitle: "Callout settled", calloutResultBody: "Your callout with @%[1]s on %[2]s is settled",
		someone: "someone", aGame: "a game",
	},
	"sq": {
		followTitle: "Ndjekës i ri", followBody: "@%[1]s nisi të të ndjekë",
		replyTitle: "Përgjigje e re", replyBody: "@%[1]s iu përgjigj komentit tënd te %[2]s",
		gameCommentTitle: "Koment i ri", gameCommentBody: "@%[1]s komentoi te %[2]s",
		scoreTitle: "Rezultati yt u thye", scoreBody: "@%[1]s theu rezultatin tënd te %[2]s",
		messageTitle: "Mesazh i ri", messageBody: "@%[1]s të dërgoi një mesazh",
		calloutTitle: "Të sfiduan", calloutBody: "@%[1]s të sfidoi te %[2]s",
		calloutResultTitle: "Sfida u mbyll", calloutResultBody: "Sfida jote me @%[1]s te %[2]s u mbyll",
		someone: "dikush", aGame: "një lojë",
	},
}

// renderPush words one notification for one device. Each notification gets a tag
// by kind and game, so a device shows the latest instead of stacking a pile.
func renderPush(row supabasedigest.PushDelivery) ([]byte, bool) {
	words, ok := pushCopies[row.Language]
	if !ok {
		words = pushCopies["en"]
	}

	var payload struct {
		Username  string `json:"username"`
		Reason    string `json:"reason"`
		Game      string `json:"game"`
		GameTitle string `json:"game_title"`
	}
	if err := json.Unmarshal(row.Payload, &payload); err != nil {
		return nil, false
	}
	player := payload.Username
	if player == "" {
		player = words.someone
	}
	game := payload.GameTitle
	if game == "" {
		game = words.aGame
	}

	var message pushMessage
	switch row.Kind {
	case "follow":
		message = pushMessage{
			Title: words.followTitle,
			Body:  fmt.Sprintf(words.followBody, player),
			URL:   "/notifications",
			Tag:   "follow",
		}
		if payload.Username != "" {
			message.URL = "/u/" + payload.Username
		}
	case "comment":
		title, body := words.gameCommentTitle, words.gameCommentBody
		if payload.Reason == "reply" {
			title, body = words.replyTitle, words.replyBody
		}
		message = pushMessage{
			Title: title,
			Body:  fmt.Sprintf(body, player, game),
			URL:   "/notifications",
			Tag:   "comment:" + payload.Game,
		}
		if payload.Game != "" {
			message.URL = "/games/" + payload.Game
		}
	case "score":
		message = pushMessage{
			Title: words.scoreTitle,
			Body:  fmt.Sprintf(words.scoreBody, player, game),
			URL:   "/notifications",
			Tag:   "score:" + payload.Game,
		}
		if payload.Game != "" {
			message.URL = "/leaderboards/" + payload.Game
		}
	case "message":
		// The sender's name only. The row holds no text, because a push is shown on a
		// lock screen.
		message = pushMessage{
			Title: words.messageTitle,
			Body:  fmt.Sprintf(words.messageBody, player),
			URL:   "/messages",
			Tag:   "message",
		}
		switch payload.Reason {
		case "challenge":
			message.Title = words.calloutTitle
			message.Body = fmt.Sprintf(words.calloutBody, player, game)
		case "challenge_result":
			message.Title = words.calloutResultTitle
			message.Body = fmt.Sprintf(words.calloutResultBody, player, game)
		}
		if payload.Username != "" {
			message.URL = "/messages/" + payload.Username
			message.Tag = "message:" + payload.Username
		}
	default:
		return nil, false
	}

	encoded, err := json.Marshal(message)
	if err != nil {
		return nil, false
	}
	return encoded, true
}

// webPushSender sends through the browsers' push services with VAPID.
type webPushSender struct {
	publicKey  string
	privateKey string
	subject    string
	client     *http.Client
}

func newWebPushSender(publicKey, privateKey, subject string) *webPushSender {
	return &webPushSender{
		publicKey:  strings.TrimSpace(publicKey),
		privateKey: strings.TrimSpace(privateKey),
		subject:    strings.TrimSpace(subject),
		client: &http.Client{
			// A push service answers directly. Following a redirect would let a
			// response choose where the next request goes.
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}
}

func (s *webPushSender) Configured() bool {
	return s.publicKey != "" && s.privateKey != ""
}

func (s *webPushSender) Send(ctx context.Context, delivery supabasedigest.PushDelivery, message []byte) (int, error) {
	response, err := webpush.SendNotificationWithContext(ctx, message, &webpush.Subscription{
		Endpoint: delivery.Endpoint,
		Keys:     webpush.Keys{P256dh: delivery.P256dh, Auth: delivery.Auth},
	}, &webpush.Options{
		HTTPClient:      s.client,
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             pushTTLSeconds,
		Urgency:         webpush.UrgencyNormal,
	})
	if err != nil {
		return 0, fmt.Errorf("sending a push: %w", redactURLError(err))
	}
	defer response.Body.Close()
	return response.StatusCode, nil
}

// redactURLError keeps a subscription's endpoint out of the logs: its path is the
// credential for sending to that device, and Go's HTTP errors quote the whole URL.
func redactURLError(err error) error {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		return urlErr.Err
	}
	return err
}
