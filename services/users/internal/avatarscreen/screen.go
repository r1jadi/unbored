// Package avatarscreen asks OpenAI's moderation endpoint whether a picture may be
// shown as a profile picture.
//
// The endpoint (`POST /v1/moderations`, model `omni-moderation-latest`) is free of
// charge and accepts images. It answers with a `flagged` verdict and per-category
// flags — sexual, sexual/minors, violence, violence/graphic, self-harm, hate,
// harassment and their sub-categories. Any flag refuses the picture: an avatar is
// shown on every leaderboard and chat, to players as young as 13, so there is no
// borderline category worth allowing.
//
// The picture travels as a base64 `data:` URL, so nothing is published before the
// verdict. Only the verdict leaves this package; the picture and OpenAI's raw
// response are never logged.
package avatarscreen

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
	"time"
)

// DefaultModel is OpenAI's current moderation model, the one that reads images.
const DefaultModel = "omni-moderation-latest"

const defaultEndpoint = "https://api.openai.com/v1/moderations"

// maxResponseBytes bounds what is read back: a verdict is a few kilobytes.
const maxResponseBytes = 1 << 20

// Verdict is the answer for one picture.
type Verdict struct {
	// Flagged is true when the picture must not be shown.
	Flagged bool
	// Categories names what was flagged, for the log and the moderators, sorted.
	Categories []string
}

// Screener checks a picture. It is an interface so the handlers are tested
// without a network.
type Screener interface {
	Screen(ctx context.Context, picture []byte, contentType string) (Verdict, error)
}

// Client calls the OpenAI moderation endpoint.
type Client struct {
	apiKey   string
	model    string
	endpoint string
	http     *http.Client
}

// New builds a client from an API key. The model may be empty for the default.
func New(apiKey, model string) (*Client, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		return nil, errors.New("OPENAI_API_KEY is required to screen profile pictures")
	}
	model = strings.TrimSpace(model)
	if model == "" {
		model = DefaultModel
	}
	return &Client{
		apiKey:   apiKey,
		model:    model,
		endpoint: defaultEndpoint,
		// A picture is at most 2 MB; this bounds a slow answer, not the upload.
		http: &http.Client{Timeout: 20 * time.Second},
	}, nil
}

// WithEndpoint points the client somewhere else: tests use it for a local server.
func (c *Client) WithEndpoint(endpoint string, httpClient *http.Client) *Client {
	copied := *c
	copied.endpoint = endpoint
	if httpClient != nil {
		copied.http = httpClient
	}
	return &copied
}

type imageURL struct {
	URL string `json:"url"`
}

type inputPart struct {
	Type     string   `json:"type"`
	ImageURL imageURL `json:"image_url"`
}

type request struct {
	Model string      `json:"model"`
	Input []inputPart `json:"input"`
}

type response struct {
	Results []struct {
		Flagged    bool            `json:"flagged"`
		Categories map[string]bool `json:"categories"`
	} `json:"results"`
}

// Error is a failed call: the status OpenAI answered with (0 when the call never
// completed) and the cause. It never carries the response body.
type Error struct {
	Status int
	cause  error
}

func (e *Error) Error() string {
	if e.Status == 0 {
		return fmt.Sprintf("openai moderation: request failed (%v)", e.cause)
	}
	return fmt.Sprintf("openai moderation: status %d", e.Status)
}

func (e *Error) Unwrap() error { return e.cause }

// Screen sends one picture and returns the verdict.
func (c *Client) Screen(ctx context.Context, picture []byte, contentType string) (Verdict, error) {
	if len(picture) == 0 {
		return Verdict{}, errors.New("an empty picture cannot be screened")
	}
	dataURL := "data:" + contentType + ";base64," + base64.StdEncoding.EncodeToString(picture)
	body, err := json.Marshal(request{
		Model: c.model,
		Input: []inputPart{{Type: "image_url", ImageURL: imageURL{URL: dataURL}}},
	})
	if err != nil {
		return Verdict{}, &Error{cause: err}
	}

	httpRequest, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return Verdict{}, &Error{cause: err}
	}
	httpRequest.Header.Set("Authorization", "Bearer "+c.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")

	httpResponse, err := c.http.Do(httpRequest)
	if err != nil {
		return Verdict{}, &Error{cause: err}
	}
	defer httpResponse.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(httpResponse.Body, maxResponseBytes))
	if err != nil {
		return Verdict{}, &Error{Status: httpResponse.StatusCode, cause: err}
	}
	if httpResponse.StatusCode < 200 || httpResponse.StatusCode >= 300 {
		return Verdict{}, &Error{Status: httpResponse.StatusCode, cause: errors.New("moderation call refused")}
	}

	var decoded response
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return Verdict{}, &Error{Status: httpResponse.StatusCode, cause: err}
	}
	if len(decoded.Results) == 0 {
		return Verdict{}, &Error{Status: httpResponse.StatusCode, cause: errors.New("moderation answered with no result")}
	}

	verdict := Verdict{}
	for _, result := range decoded.Results {
		if result.Flagged {
			verdict.Flagged = true
		}
		for category, on := range result.Categories {
			if on {
				verdict.Flagged = true
				verdict.Categories = append(verdict.Categories, category)
			}
		}
	}
	sort.Strings(verdict.Categories)
	return verdict, nil
}
