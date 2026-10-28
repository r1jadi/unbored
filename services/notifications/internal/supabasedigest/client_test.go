package supabasedigest

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func testClient(t *testing.T, handler http.HandlerFunc) *Client {
	t.Helper()
	server := httptest.NewServer(handler)
	t.Cleanup(server.Close)
	return &Client{
		baseURL: server.URL,
		key:     "sb_secret_test",
		http:    server.Client(),
	}
}

func TestClaimDecodesAnOpenDigest(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/rest/v1/rpc/claim_game_release_digest" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.Header.Get("apikey") != "sb_secret_test" || r.Header.Get("Authorization") != "Bearer sb_secret_test" {
			t.Errorf("missing service credentials")
		}
		_, _ = io.WriteString(w, `"digest-1"`)
	})

	id, found, err := client.Claim(context.Background())
	if err != nil || !found || id != "digest-1" {
		t.Fatalf("Claim = %q, %v, %v", id, found, err)
	}
}

func TestClaimReadsNullAsNotReady(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `null`)
	})

	id, found, err := client.Claim(context.Background())
	if err != nil || found || id != "" {
		t.Fatalf("Claim = %q, %v, %v", id, found, err)
	}
}

func TestRecipientsAndRecordUseTheFunctionArguments(t *testing.T) {
	var seen []map[string]any
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		_ = json.NewDecoder(r.Body).Decode(&payload)
		seen = append(seen, payload)
		switch r.URL.Path {
		case "/rest/v1/rpc/game_release_digest_recipients":
			_, _ = io.WriteString(w, `[{"user_id":"u1","email":"a@example.com","username":"a","display_name":"A"}]`)
		case "/rest/v1/rpc/record_game_release_digest_delivery":
			w.WriteHeader(http.StatusNoContent)
		default:
			t.Errorf("unexpected path %q", r.URL.Path)
		}
	})

	recipients, err := client.Recipients(context.Background(), "digest-1", 25)
	if err != nil || len(recipients) != 1 || recipients[0].Email != "a@example.com" {
		t.Fatalf("Recipients = %+v, %v", recipients, err)
	}
	if err := client.Record(context.Background(), "digest-1", "u1", "delivery failed"); err != nil {
		t.Fatalf("Record: %v", err)
	}
	if len(seen) != 2 {
		t.Fatalf("calls = %d", len(seen))
	}
	if seen[0]["p_digest_id"] != "digest-1" || seen[0]["p_limit"] != float64(25) {
		t.Errorf("recipient payload = %v", seen[0])
	}
	if seen[1]["p_failure"] != "delivery failed" {
		t.Errorf("record payload = %v", seen[1])
	}
}

func TestCloseDecodesTheBoolean(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, `true`)
	})
	closed, err := client.Close(context.Background(), "digest-1")
	if err != nil || !closed {
		t.Fatalf("Close = %v, %v", closed, err)
	}
}

func TestCallReportsADatabaseRefusalWithoutLeakingItsMessage(t *testing.T) {
	client := testClient(t, func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusForbidden)
		_, _ = io.WriteString(w, `{"code":"42501","message":"permission denied for function claim_game_release_digest"}`)
	})
	_, err := client.Games(context.Background(), "digest-1")
	if err == nil {
		t.Fatal("expected an error")
	}
	if strings.Contains(err.Error(), "permission denied") {
		t.Fatalf("error leaked the database message: %v", err)
	}
	if !strings.Contains(err.Error(), "42501") {
		t.Fatalf("error = %v, want the SQLSTATE", err)
	}
}
