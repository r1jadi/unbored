package notifications

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	webpush "github.com/SherClockHolmes/webpush-go"

	"github.com/r1jadi/unbored/services/notifications/internal/supabasedigest"
)

type fakePushBackend struct {
	mu      sync.Mutex
	batches [][]supabasedigest.PushDelivery
	claims  int
	deleted []string
	err     error
}

func (f *fakePushBackend) ClaimPushBatch(context.Context, int) ([]supabasedigest.PushDelivery, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.claims++
	if f.err != nil {
		return nil, f.err
	}
	if len(f.batches) == 0 {
		return nil, nil
	}
	batch := f.batches[0]
	f.batches = f.batches[1:]
	return batch, nil
}

func (f *fakePushBackend) DeletePushSubscriptions(_ context.Context, ids []string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleted = append(f.deleted, ids...)
	return nil
}

type fakePushSender struct {
	mu         sync.Mutex
	configured bool
	statuses   map[string]int
	errs       map[string]error
	sent       map[string][]byte
}

func (f *fakePushSender) Configured() bool { return f.configured }

func (f *fakePushSender) Send(_ context.Context, delivery supabasedigest.PushDelivery, message []byte) (int, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.sent == nil {
		f.sent = map[string][]byte{}
	}
	f.sent[delivery.SubscriptionID] = message
	if err := f.errs[delivery.SubscriptionID]; err != nil {
		return 0, err
	}
	if status, ok := f.statuses[delivery.SubscriptionID]; ok {
		return status, nil
	}
	return http.StatusCreated, nil
}

func delivery(id, kind, payload string) supabasedigest.PushDelivery {
	return supabasedigest.PushDelivery{
		NotificationID: "n-" + id,
		Kind:           kind,
		Payload:        json.RawMessage(payload),
		SubscriptionID: id,
		Endpoint:       "https://fcm.googleapis.com/fcm/send/" + id,
		Language:       "en",
	}
}

func dispatch(t *testing.T, s *pushService, authorization string) (*httptest.ResponseRecorder, pushResponse) {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, PushDispatchPath, nil)
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	}
	recorder := httptest.NewRecorder()
	s.dispatch(recorder, request)
	var body pushResponse
	_ = json.Unmarshal(recorder.Body.Bytes(), &body)
	return recorder, body
}

func TestDispatchRefusesAWrongOrMissingSecret(t *testing.T) {
	backend := &fakePushBackend{}
	s := newPushService(backend, &fakePushSender{configured: true}, slog.Default(), "right")

	for _, authorization := range []string{"", "Bearer wrong", "right"} {
		recorder, _ := dispatch(t, s, authorization)
		if recorder.Code != http.StatusUnauthorized {
			t.Errorf("%q: status = %d, want 401", authorization, recorder.Code)
		}
	}
	if backend.claims != 0 {
		t.Fatalf("claims = %d: an unauthenticated request must not touch the outbox", backend.claims)
	}
}

func TestDispatchIsDisabledWithoutASecret(t *testing.T) {
	backend := &fakePushBackend{}
	s := newPushService(backend, &fakePushSender{configured: true}, slog.Default(), " ")

	recorder, _ := dispatch(t, s, "Bearer ")
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503: an empty secret must not open the route", recorder.Code)
	}
	if backend.claims != 0 {
		t.Fatal("the outbox was claimed with no secret configured")
	}
}

func TestDispatchClaimsNothingWithoutVAPIDKeys(t *testing.T) {
	// A claimed notification is never offered again, so claiming with no way to send
	// would silently lose it.
	backend := &fakePushBackend{batches: [][]supabasedigest.PushDelivery{{delivery("a", "follow", `{}`)}}}
	s := newPushService(backend, &fakePushSender{configured: false}, slog.Default(), "right")

	recorder, _ := dispatch(t, s, "Bearer right")
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", recorder.Code)
	}
	if backend.claims != 0 {
		t.Fatal("notifications were claimed with no VAPID keys")
	}
}

func TestDispatchSendsAndSummarises(t *testing.T) {
	backend := &fakePushBackend{batches: [][]supabasedigest.PushDelivery{{
		delivery("ok", "follow", `{"username":"rijad"}`),
		delivery("gone", "follow", `{"username":"rijad"}`),
		delivery("missing", "follow", `{"username":"rijad"}`),
		delivery("broken", "follow", `{"username":"rijad"}`),
		delivery("refused", "follow", `{"username":"rijad"}`),
	}}}
	sender := &fakePushSender{
		configured: true,
		statuses:   map[string]int{"gone": http.StatusGone, "missing": http.StatusNotFound, "refused": http.StatusTooManyRequests},
		errs:       map[string]error{"broken": errors.New("network down")},
	}
	s := newPushService(backend, sender, slog.Default(), "right")

	recorder, body := dispatch(t, s, "Bearer right")
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	if body.Sent != 1 || body.Expired != 2 || body.Failed != 2 {
		t.Fatalf("summary = %+v, want one failure not to stop the others", body)
	}
	// Only a subscription the service says is gone is removed; a refusal or an
	// outage says nothing about whether the device still exists.
	if len(backend.deleted) != 2 || strings.Contains(strings.Join(backend.deleted, ","), "refused") {
		t.Fatalf("deleted = %v, want only gone and missing", backend.deleted)
	}
}

func TestDispatchDrainsBatchesButIsBounded(t *testing.T) {
	batches := make([][]supabasedigest.PushDelivery, 0, pushMaxBatches+2)
	for range pushMaxBatches + 2 {
		batches = append(batches, []supabasedigest.PushDelivery{delivery("a", "follow", `{}`)})
	}
	backend := &fakePushBackend{batches: batches}
	s := newPushService(backend, &fakePushSender{configured: true}, slog.Default(), "right")

	_, body := dispatch(t, s, "Bearer right")
	if backend.claims != pushMaxBatches || body.Sent != pushMaxBatches {
		t.Fatalf("claims = %d, sent = %d, want %d of each", backend.claims, body.Sent, pushMaxBatches)
	}
}

func TestDispatchNeverContactsAnEndpointThatIsNotAPushService(t *testing.T) {
	// The database refuses these, but this is the line that makes the request.
	for _, endpoint := range []string{
		"http://169.254.169.254/latest/meta-data",
		"https://localhost/x",
		"http://fcm.googleapis.com/fcm/send/x",
		"https://fcm.googleapis.com.evil.example/x",
		"https://evil.example/fcm.googleapis.com/",
		"https://push.apple.com.evil.example/x",
	} {
		row := delivery("bad", "follow", `{}`)
		row.Endpoint = endpoint
		backend := &fakePushBackend{batches: [][]supabasedigest.PushDelivery{{row}}}
		sender := &fakePushSender{configured: true}
		_, body := dispatch(t, newPushService(backend, sender, slog.Default(), "right"), "Bearer right")
		if len(sender.sent) != 0 || body.Failed != 1 {
			t.Errorf("%s: sent = %d, summary = %+v", endpoint, len(sender.sent), body)
		}
	}

	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/x",
		"https://web.push.apple.com/x",
		"https://wns2-par02p.notify.windows.com/w/?token=x",
		"https://updates.push.services.mozilla.com/wpush/v2/x",
	} {
		if !pushEndpoint.MatchString(endpoint) {
			t.Errorf("%s: a real push service was refused", endpoint)
		}
	}
}

func TestRenderPushWordsEachKindForTheDevicesLanguage(t *testing.T) {
	cases := []struct {
		name, kind, payload, language string
		want                          pushMessage
	}{
		{"follow", "follow", `{"username":"rijad"}`, "en",
			pushMessage{"New follower", "@rijad started following you", "/u/rijad", "follow"}},
		{"reply", "comment", `{"username":"rijad","reason":"reply","game":"decant","game_title":"Decant"}`, "en",
			pushMessage{"New reply", "@rijad replied to your comment on Decant", "/games/decant", "comment:decant"}},
		{"game comment", "comment", `{"username":"rijad","reason":"game_comment","game":"decant","game_title":"Decant"}`, "en",
			pushMessage{"New comment", "@rijad commented on Decant", "/games/decant", "comment:decant"}},
		{"score", "score", `{"username":"rijad","game":"decant","game_title":"Decant"}`, "en",
			pushMessage{"Your score was beaten", "@rijad beat your score on Decant", "/leaderboards/decant", "score:decant"}},
		{"albanian", "score", `{"username":"rijad","game":"decant","game_title":"Decant"}`, "sq",
			pushMessage{"Rezultati yt u thye", "@rijad theu rezultatin tënd te Decant", "/leaderboards/decant", "score:decant"}},
		{"unknown language", "follow", `{"username":"rijad"}`, "xx",
			pushMessage{"New follower", "@rijad started following you", "/u/rijad", "follow"}},
		{"nameless", "follow", `{}`, "en",
			pushMessage{"New follower", "@someone started following you", "/notifications", "follow"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			row := delivery("a", tc.kind, tc.payload)
			row.Language = tc.language
			raw, ok := renderPush(row)
			if !ok {
				t.Fatal("not rendered")
			}
			var got pushMessage
			if err := json.Unmarshal(raw, &got); err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("got %+v, want %+v", got, tc.want)
			}
		})
	}
}

func TestRenderPushRefusesKindsThatDoNotPush(t *testing.T) {
	if _, ok := renderPush(delivery("a", "moderation", `{}`)); ok {
		t.Fatal("a moderation notification was rendered for push")
	}
	if _, ok := renderPush(delivery("a", "follow", `not json`)); ok {
		t.Fatal("a malformed payload was rendered")
	}
}

// browserKeys are the two values a browser's PushSubscription holds.
func browserKeys(t *testing.T) (p256dh, auth string) {
	t.Helper()
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	secret := make([]byte, 16)
	if _, err := rand.Read(secret); err != nil {
		t.Fatal(err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	return encode(key.PublicKey().Bytes()), encode(secret)
}

func TestWebPushSenderEncryptsAndSignsTheMessage(t *testing.T) {
	var header http.Header
	var body []byte
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header = r.Header.Clone()
		body, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusCreated)
	}))
	defer server.Close()

	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	p256dh, auth := browserKeys(t)
	sender := newWebPushSender(public, private, "https://unbored.lol")
	if !sender.Configured() {
		t.Fatal("not configured")
	}

	secretMessage := []byte(`{"title":"visible only to the device"}`)
	status, err := sender.Send(context.Background(), supabasedigest.PushDelivery{
		Endpoint: server.URL + "/send/device",
		P256dh:   p256dh,
		Auth:     auth,
	}, secretMessage)
	if err != nil {
		t.Fatalf("Send: %v", err)
	}
	if status != http.StatusCreated {
		t.Fatalf("status = %d", status)
	}
	if got := header.Get("Content-Encoding"); got != "aes128gcm" {
		t.Errorf("Content-Encoding = %q", got)
	}
	if got := header.Get("Authorization"); !strings.HasPrefix(got, "vapid t=") || !strings.Contains(got, "k="+public) {
		t.Errorf("Authorization = %q, want VAPID with the public key", got)
	}
	if header.Get("TTL") == "" {
		t.Error("no TTL")
	}
	// The push service in the middle must not be able to read it.
	if strings.Contains(string(body), "visible only") {
		t.Fatal("the message left the server unencrypted")
	}
}

func TestWebPushSenderIsNotConfiguredWithoutBothKeys(t *testing.T) {
	if newWebPushSender("", "x", "s").Configured() || newWebPushSender("x", " ", "s").Configured() {
		t.Fatal("a sender missing a key reported itself configured")
	}
}

func TestSendErrorsDoNotQuoteTheEndpoint(t *testing.T) {
	private, public, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		t.Fatal(err)
	}
	p256dh, auth := browserKeys(t)
	_, err = newWebPushSender(public, private, "https://unbored.lol").Send(context.Background(),
		supabasedigest.PushDelivery{Endpoint: "http://127.0.0.1:1/secret-device-token", P256dh: p256dh, Auth: auth},
		[]byte("{}"))
	if err == nil {
		t.Fatal("expected a connection failure")
	}
	if strings.Contains(err.Error(), "secret-device-token") {
		t.Fatalf("the error quotes the endpoint: %v", err)
	}
}
