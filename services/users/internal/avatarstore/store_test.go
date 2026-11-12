package avatarstore

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type seen struct {
	method, path, auth, apikey, body string
}

func stub(t *testing.T, status int, reply string, header http.Header) (*Client, *[]seen) {
	t.Helper()
	var requests []seen
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, _ := io.ReadAll(r.Body)
		requests = append(requests, seen{r.Method, r.URL.String(), r.Header.Get("Authorization"), r.Header.Get("apikey"), string(raw)})
		for key, values := range header {
			w.Header()[key] = values
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(server.Close)
	client := (&Client{secret: "sb_secret_test"}).WithHTTP(server.URL, server.Client())
	return client, &requests
}

func TestFetchReadsTheHoldingBucketWithTheSecret(t *testing.T) {
	client, requests := stub(t, 200, "\x89PNG", http.Header{"Content-Type": {"image/png; charset=binary"}})
	picture, contentType, err := client.Fetch(context.Background(), "abc/new file.png")
	if err != nil {
		t.Fatal(err)
	}
	if string(picture) != "\x89PNG" || contentType != "image/png" {
		t.Errorf("got %q %q", picture, contentType)
	}
	got := (*requests)[0]
	if got.method != http.MethodGet || got.path != "/storage/v1/object/avatar-uploads/abc/new%20file.png" {
		t.Errorf("request = %s %s", got.method, got.path)
	}
	if got.auth != "Bearer sb_secret_test" || got.apikey != "sb_secret_test" {
		t.Errorf("credentials = %q / %q", got.auth, got.apikey)
	}
}

func TestFetchReportsAMissingObject(t *testing.T) {
	client, _ := stub(t, 404, `{"error":"not_found"}`, nil)
	if _, _, err := client.Fetch(context.Background(), "abc/x.png"); err != ErrNotFound {
		t.Fatalf("err = %v, want ErrNotFound", err)
	}
}

func TestPublishAndSetAvatarPath(t *testing.T) {
	client, requests := stub(t, 200, `{}`, nil)
	if err := client.Publish(context.Background(), "abc/x.png", []byte("pic"), "image/png"); err != nil {
		t.Fatal(err)
	}
	if err := client.SetAvatarPath(context.Background(), "abc", "abc/x.png"); err != nil {
		t.Fatal(err)
	}
	publish, set := (*requests)[0], (*requests)[1]
	if publish.method != http.MethodPost || publish.path != "/storage/v1/object/avatars/abc/x.png" || publish.body != "pic" {
		t.Errorf("publish = %+v", publish)
	}
	if set.method != http.MethodPatch || !strings.HasPrefix(set.path, "/rest/v1/profiles?id=eq.abc") ||
		set.body != `{"avatar_path":"abc/x.png"}` {
		t.Errorf("set = %+v", set)
	}
}

func TestRemoveTreatsAMissingObjectAsDone(t *testing.T) {
	client, _ := stub(t, 404, ``, nil)
	if err := client.Remove(context.Background(), PublicBucket, "abc/x.png"); err != nil {
		t.Fatalf("err = %v", err)
	}
}
