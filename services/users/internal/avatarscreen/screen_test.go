package avatarscreen

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestScreenSendsThePictureAndReadsTheVerdict(t *testing.T) {
	cases := map[string]struct {
		body           string
		wantFlagged    bool
		wantCategories []string
	}{
		"a clean picture": {
			body:        `{"results":[{"flagged":false,"categories":{"sexual":false,"violence":false}}]}`,
			wantFlagged: false,
		},
		"an explicit picture": {
			body:           `{"results":[{"flagged":true,"categories":{"sexual":true,"violence":false,"sexual/minors":true}}]}`,
			wantFlagged:    true,
			wantCategories: []string{"sexual", "sexual/minors"},
		},
		"a category without the overall flag still refuses": {
			body:           `{"results":[{"flagged":false,"categories":{"violence/graphic":true}}]}`,
			wantFlagged:    true,
			wantCategories: []string{"violence/graphic"},
		},
	}
	for name, testCase := range cases {
		t.Run(name, func(t *testing.T) {
			var sent request
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Authorization") != "Bearer test-key" {
					t.Errorf("Authorization = %q", r.Header.Get("Authorization"))
				}
				raw, _ := io.ReadAll(r.Body)
				if err := json.Unmarshal(raw, &sent); err != nil {
					t.Fatalf("request body: %v", err)
				}
				w.Header().Set("Content-Type", "application/json")
				_, _ = w.Write([]byte(testCase.body))
			}))
			defer server.Close()

			client, err := New("test-key", "")
			if err != nil {
				t.Fatal(err)
			}
			verdict, err := client.WithEndpoint(server.URL, server.Client()).
				Screen(context.Background(), []byte{0x89, 'P', 'N', 'G'}, "image/png")
			if err != nil {
				t.Fatalf("screen: %v", err)
			}
			if verdict.Flagged != testCase.wantFlagged {
				t.Errorf("flagged = %v, want %v", verdict.Flagged, testCase.wantFlagged)
			}
			if strings.Join(verdict.Categories, ",") != strings.Join(testCase.wantCategories, ",") {
				t.Errorf("categories = %v, want %v", verdict.Categories, testCase.wantCategories)
			}
			if sent.Model != DefaultModel || len(sent.Input) != 1 || sent.Input[0].Type != "image_url" {
				t.Errorf("request = %+v", sent)
			}
			if !strings.HasPrefix(sent.Input[0].ImageURL.URL, "data:image/png;base64,") {
				t.Errorf("the picture was not sent as a data URL")
			}
		})
	}
}

func TestScreenReportsAFailedCallAsAnError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTooManyRequests)
	}))
	defer server.Close()

	client, _ := New("test-key", "")
	if _, err := client.WithEndpoint(server.URL, server.Client()).
		Screen(context.Background(), []byte("x"), "image/png"); err == nil {
		t.Fatal("a refused call was reported as a verdict")
	}
}

func TestNewRefusesAMissingKey(t *testing.T) {
	if _, err := New("  ", ""); err == nil {
		t.Fatal("a missing key was accepted")
	}
}
