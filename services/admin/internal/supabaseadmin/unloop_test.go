package supabaseadmin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestSignUnloopUpload(t *testing.T) {
	var gotPath, gotAuth string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotAuth = r.URL.Path, r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"url":"/object/upload/sign/unloop/videos/a.mp4?token=abc"}`))
	}))
	defer server.Close()

	privileged := &Client{baseURL: server.URL, apiKey: "pub", secret: "sec", http: server.Client()}
	url, err := privileged.SignUnloopUpload(context.Background(), "caller", "videos/a.mp4")
	if err != nil {
		t.Fatal(err)
	}
	if want := server.URL + "/storage/v1/object/upload/sign/unloop/videos/a.mp4?token=abc"; url != want {
		t.Errorf("url = %q, want %q", url, want)
	}
	if gotPath != "/storage/v1/object/upload/sign/unloop/videos/a.mp4" || gotAuth != "Bearer sec" {
		t.Errorf("signed as %q at %q, want the secret at the bucket path", gotAuth, gotPath)
	}

	caller := &Client{baseURL: server.URL, apiKey: "pub", http: server.Client()}
	if _, err := caller.SignUnloopUpload(context.Background(), "caller", "videos/a.mp4"); err != nil || gotAuth != "Bearer caller" {
		t.Errorf("without the secret: err %v, auth %q; want the caller's own token", err, gotAuth)
	}
}

func TestSignUnloopUploadRefusesAForeignURL(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"url":"https://elsewhere.example/upload?token=abc"}`))
	}))
	defer server.Close()
	client := &Client{baseURL: server.URL, apiKey: "pub", secret: "sec", http: server.Client()}
	if _, err := client.SignUnloopUpload(context.Background(), "caller", "videos/a.mp4"); err == nil {
		t.Error("an unexpected signed URL was passed on")
	}
}
