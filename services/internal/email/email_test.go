package email

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSendDisabledWithoutKey(t *testing.T) {
	_, err := New("", "Unbored <hello@unbored.lol>").Send(context.Background(), Message{})
	if !errors.Is(err, ErrNotConfigured) {
		t.Fatalf("err = %v, want ErrNotConfigured", err)
	}
}

func TestSendPostsToResend(t *testing.T) {
	var got Message
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer re_test" {
			t.Errorf("authorization = %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("Idempotency-Key") != "welcome/u1" {
			t.Errorf("idempotency key = %q", r.Header.Get("Idempotency-Key"))
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"id":"email_123"}`))
	}))
	defer srv.Close()

	s := New("re_test", "Unbored <hello@unbored.lol>")
	s.endpoint = srv.URL
	id, err := s.Send(context.Background(), Message{
		To: []string{"a@example.com"}, Subject: "Hi", Text: "Hello", IdempotencyKey: "welcome/u1",
	})
	if err != nil || id != "email_123" {
		t.Fatalf("Send = %q, %v", id, err)
	}
	if got.From != "Unbored <hello@unbored.lol>" || got.Subject != "Hi" || got.To[0] != "a@example.com" {
		t.Fatalf("payload = %+v", got)
	}
}

func TestSendReportsAPIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"name":"validation_error","message":"bad from"}`))
	}))
	defer srv.Close()

	s := New("re_test", "x@unbored.lol")
	s.endpoint = srv.URL
	if _, err := s.Send(context.Background(), Message{To: []string{"a@example.com"}, Subject: "Hi", Text: "x"}); err == nil {
		t.Fatal("expected an error")
	}
}
