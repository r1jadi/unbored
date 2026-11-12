// Package users defines the Users service and its entrypoints.
//
// It owns the application profile: the row in `public.profiles` that every other
// part of the product renders as "this person" — username, display name, bio,
// avatar and onboarding state. Credentials, email and sessions belong to
// services/auth; this service never sees a password and never issues a token.
//
// Two rules shape the whole package:
//
//   - **"me" means the token.** The caller's id is read from the identity the
//     JWKS middleware verified and is never taken from the body, a query value or
//     a header. There is no parameter to get wrong: the routes that address a
//     person other than the caller do not exist in this service yet.
//   - **The caller's own token is the credential.** Reads and writes go to the
//     Data API with the caller's access token, so Row Level Security decides what
//     is visible and which columns are writable. The service holds no secret key,
//     so a bug here cannot read another account's data or grant a role.
//
// What a caller may write is the database's decision, not this service's: the
// UPDATE grant on `profiles` covers `username`, `display_name`, `bio`,
// `avatar_path` and `onboarded_at`. `is_suspended` and the timestamps are not
// writable by any client, and a request that names one of them is rejected with a
// 400 that names the field rather than silently dropped.
package users

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/authn"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/packages/go/platform/identity"
	"github.com/r1jadi/unbored/services/internal/servicekit"
	"github.com/r1jadi/unbored/services/users/internal/supabaseprofile"
)

// Name is the service name used in logs, configuration validation and the
// SERVICE_NAME default.
const Name = "users"

// ProfilePath is the only route this service publishes today. It is a constant so
// the contract, the tests and the README cannot drift from the router.
const ProfilePath = "/api/v1/users/me"

const (
	// maxPatchBytes bounds a profile body. The largest legal body is a 60-character
	// name, a 300-character bio and a 160-character avatar path, so this is two
	// orders of magnitude of headroom rather than a real ceiling.
	maxPatchBytes = 8 << 10

	// Field limits, matching the constraints in `public.profiles` exactly. The
	// database is still the authority — it is what makes these limits true for
	// every writer — but enforcing them here turns a 23514 into a message that
	// names the field and the rule.
	maxDisplayNameRunes = 60
	maxBioRunes         = 300
	maxAvatarPathRunes  = 160
)

// avatarPathPattern mirrors `profiles_avatar_path_format`: an object path under
// the caller's own id, `<uuid>/<filename>`. The bucket is per-user by
// construction, which is why the id has to be a prefix rather than a free-form
// key.
var avatarPathPattern = regexp.MustCompile(`^[0-9a-f-]{36}/[a-z0-9._-]{1,120}$`)

// usernamePattern mirrors `profiles_username_format`: 3–24 lowercase letters,
// digits and underscores. Case-insensitive uniqueness comes from the citext
// unique index, so the pattern is what keeps two spellings of one name from
// ever reaching it.
var usernamePattern = regexp.MustCompile(`^[a-z0-9_]{3,24}$`)

// Backend is the profile surface this service needs. It is an interface so the
// handlers are tested without a network, and so a deployment that has not been
// given Supabase credentials can still boot, serve its probes, and answer 503 on
// this route instead of crash-looping.
type Backend interface {
	GetProfile(ctx context.Context, accessToken, userID string) (supabaseprofile.Profile, bool, error)
	Update(ctx context.Context, accessToken, userID string, patch supabaseprofile.Patch, expectedUpdatedAt time.Time) (supabaseprofile.Profile, bool, error)
}

// profileView is the API's view of a profile.
//
// It is assembled field by field rather than by re-encoding the row, so a column
// added to `profiles` later cannot appear in a response by accident. `role` comes
// from the verified token rather than the table, which keeps this payload and
// `/api/v1/auth/session` reporting the same role for the same token.
type profileView struct {
	ID          string     `json:"id"`
	Username    string     `json:"username"`
	DisplayName string     `json:"displayName"`
	Bio         *string    `json:"bio"`
	AvatarPath  *string    `json:"avatarPath"`
	Role        string     `json:"role"`
	OnboardedAt *time.Time `json:"onboardedAt"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   time.Time  `json:"updatedAt"`
}

// patchRequest is the body of PATCH /users/me.
//
// `bio` and `avatarPath` are raw JSON so the handler can tell "absent" from
// "explicitly null": a nil `*string` cannot, and clearing a bio is a legitimate
// edit that must not be indistinguishable from leaving it alone. Neither field is
// a writable role or suspension flag — a request that carries one of those has
// an unknown field here and is refused by the strict decoder.
type patchRequest struct {
	DisplayName *string `json:"displayName"`
	Username    *string `json:"username"`
	Bio         json.RawMessage
	AvatarPath  json.RawMessage
	// ExpectedUpdatedAt is the optimistic-concurrency control. A client that
	// read the profile sends the `updatedAt` it saw; the write then applies only
	// if the row still holds that value, so a second writer gets a 409 instead of
	// silently overwriting a change they never saw. Omitting it accepts
	// last-write-wins, which is what the contract documents.
	ExpectedUpdatedAt *time.Time `json:"expectedUpdatedAt"`
}

// service holds the handlers' dependencies. `backend` is nil when the deployment
// has no Supabase credentials, which is a diagnosable state rather than a crash.
type service struct {
	backend Backend
	logger  *slog.Logger
	// avatars publishes screened profile pictures. Nil when the deployment has
	// no secret key or no OpenAI key: the upload route then answers 503.
	avatars *avatarPipeline
}

func newService(backend Backend, logger *slog.Logger) *service {
	if logger == nil {
		logger = slog.Default()
	}
	return &service{backend: backend, logger: logger}
}

// register mounts the routes. Both require a verified token: the middleware
// rejects a missing or invalid one with 401 before a handler runs, so no handler
// here has to decide whether the caller is signed in.
func (s *service) register(router *httpx.Router) {
	router.AuthenticatedFunc("GET "+ProfilePath, s.currentProfile)
	router.AuthenticatedFunc("PATCH "+ProfilePath, s.updateProfile)
	router.AuthenticatedFunc("POST "+AvatarPath, s.uploadAvatar)
}

// ── Handlers ────────────────────────────────────────────────────────────────

func (s *service) currentProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := caller(w, r)
	if !ok {
		return
	}
	if s.backend == nil {
		s.notConfigured(w, r, "read a profile")
		return
	}

	profile, found, err := s.backend.GetProfile(r.Context(), bearer(r), user.UserID)
	if err != nil {
		s.dataFailure(w, r, "read a profile", err)
		return
	}
	if !found {
		// Every account gets a row from the `handle_new_user` trigger, so this is
		// an account whose profile is genuinely missing — not an empty state the
		// UI should paper over with placeholder identity.
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound,
			"This account has no profile yet."))
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, view(profile, user.Role))
}

func (s *service) updateProfile(w http.ResponseWriter, r *http.Request) {
	user, ok := caller(w, r)
	if !ok {
		return
	}

	var request patchRequest
	if err := httpx.DecodeJSON(w, r, maxPatchBytes, &request); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	patch, expected, ok := validated(w, r, request)
	if !ok {
		return
	}
	if s.backend == nil {
		s.notConfigured(w, r, "update a profile")
		return
	}

	profile, updated, err := s.backend.Update(r.Context(), bearer(r), user.UserID, patch, expected)
	if err != nil {
		s.dataFailure(w, r, "update a profile", err)
		return
	}
	if !updated {
		// Nothing matched. Either the row is gone, or the caller's
		// `expectedUpdatedAt` is stale. Reading the row back is what tells them
		// apart, and the two need different answers: one is "no profile", the
		// other is "someone else changed this, reload and try again".
		if _, found, readErr := s.backend.GetProfile(r.Context(), bearer(r), user.UserID); readErr == nil && found {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict,
				"This profile changed since you loaded it. Reload and try again."))
			return
		}
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeNotFound,
			"This account has no profile yet."))
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, view(profile, user.Role))
}

// ── Validation ──────────────────────────────────────────────────────────────

// validated turns the decoded body into a column patch, writing the response
// itself when the request cannot be applied. It never returns a partially
// accepted patch: an invalid field is a refusal, not a field to skip.
func validated(w http.ResponseWriter, r *http.Request, request patchRequest) (supabaseprofile.Patch, time.Time, bool) {
	patch := supabaseprofile.Patch{}
	fields := 0

	if request.DisplayName != nil {
		name := strings.TrimSpace(*request.DisplayName)
		switch {
		case name == "":
			return reject(w, r, "displayName", "required", "Add a display name.")
		case utf8.RuneCountInString(name) > maxDisplayNameRunes:
			return reject(w, r, "displayName", "maxLength", "Use at most 60 characters for your display name.")
		}
		patch.DisplayName = name
		fields++
	}

	if request.Username != nil {
		// Usernames cannot contain spaces, so trimming is not a transformation
		// of intent — it forgives an accidental touch of the space bar.
		name := strings.TrimSpace(*request.Username)
		switch {
		case name == "":
			return reject(w, r, "username", "required", "Add a username.")
		case utf8.RuneCountInString(name) < 3 || utf8.RuneCountInString(name) > 24:
			return reject(w, r, "username", "length", "Use 3–24 characters for your username.")
		case !usernamePattern.MatchString(name):
			return reject(w, r, "username", "format", "Use only lowercase letters, numbers and underscores.")
		}
		patch.Username = name
		fields++
	}

	if bio, present, ok := nullableText(w, r, request.Bio, "bio", maxBioRunes); !ok {
		return supabaseprofile.Patch{}, time.Time{}, false
	} else if present {
		patch.Bio, patch.SetBio = bio, true
		fields++
	}

	if avatar, present, ok := nullableText(w, r, request.AvatarPath, "avatarPath", maxAvatarPathRunes); !ok {
		return supabaseprofile.Patch{}, time.Time{}, false
	} else if present {
		// Only removing the picture is a profile edit. Setting one goes through
		// POST /users/me/avatar, which screens it first; the database refuses a
		// path from a player's token anyway (profiles_avatar_path_server_only).
		if avatar != nil && *avatar != "" {
			return reject(w, r, "avatarPath", "upload", "Upload a picture to change it; this field can only remove it.")
		}
		if avatar != nil && *avatar == "" {
			avatar = nil
		}
		patch.AvatarPath, patch.SetAvatar = avatar, true
		fields++
	}

	if fields == 0 {
		return reject(w, r, "displayName", "required", "Provide at least one field to update.")
	}

	var expected time.Time
	if request.ExpectedUpdatedAt != nil {
		expected = *request.ExpectedUpdatedAt
	}
	return patch, expected, true
}

// nullableText reads a field that may be absent, set to a string, or set to null.
// present reports whether the client mentioned it at all; a nil value with
// present true means "clear this column".
func nullableText(w http.ResponseWriter, r *http.Request, raw json.RawMessage, field string, limit int) (*string, bool, bool) {
	if len(raw) == 0 {
		return nil, false, true
	}
	if string(raw) == "null" {
		return nil, true, true
	}

	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeBadRequest,
			"The request body contains a value of the wrong type.",
			apierr.Detail{Field: field, Rule: "type"}))
		return nil, false, false
	}
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > limit {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That value is too long.",
			apierr.Detail{Field: field, Rule: "maxLength"}))
		return nil, false, false
	}
	return &value, true, true
}

func reject(w http.ResponseWriter, r *http.Request, field, rule, message string) (supabaseprofile.Patch, time.Time, bool) {
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable, message, apierr.Detail{Field: field, Rule: rule}))
	return supabaseprofile.Patch{}, time.Time{}, false
}

// ── Response building ───────────────────────────────────────────────────────

func view(profile supabaseprofile.Profile, role string) profileView {
	return profileView{
		ID:          profile.ID,
		Username:    profile.Username,
		DisplayName: profile.DisplayName,
		Bio:         profile.Bio,
		AvatarPath:  profile.AvatarPath,
		Role:        identity.NormalizeRole(role),
		OnboardedAt: profile.OnboardedAt,
		CreatedAt:   profile.CreatedAt,
		UpdatedAt:   profile.UpdatedAt,
	}
}

// ── Request handling ────────────────────────────────────────────────────────

// caller reads the identity the middleware verified. The second return is false
// only when the request somehow reached a handler unauthenticated, which the
// route registration makes unreachable; the check exists so the handler is safe
// if that ever changes.
func caller(w http.ResponseWriter, r *http.Request) (identity.Identity, bool) {
	id := identity.MustFromContext(r.Context())
	if id.Anonymous || id.UserID == "" {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnauthorized, "Sign in to continue."))
		return id, false
	}
	return id, true
}

func bearer(r *http.Request) string {
	return authn.BearerToken(r.Header.Get("Authorization"))
}

// notConfigured answers a route whose Supabase dependency is missing. It names no
// variable and carries no value: the log line is where the operator finds out
// what to set.
func (s *service) notConfigured(w http.ResponseWriter, r *http.Request, operation string) {
	s.logger.WarnContext(r.Context(), "users dependency is not configured", slog.String("operation", operation))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Profiles are not available right now."))
}

// dataFailure maps a Data API failure onto the platform's envelope.
//
// Only a message written here is ever sent. The database's own text can describe
// the schema, and the caller's input can appear in it, so the machine-readable
// code decides the classification and the wording is ours.
func (s *service) dataFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	var dataErr *supabaseprofile.Error
	if errors.As(err, &dataErr) {
		switch {
		case dataErr.IsForbidden():
			// The caller named a column the UPDATE grant excludes, or RLS
			// refused the row. Either way the request was understood and not
			// allowed, which is a 403 and not a validation 400.
			s.logger.InfoContext(r.Context(), "profile write refused by the database",
				slog.String("operation", operation), slog.String("code", dataErr.Code))
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeForbidden, "That profile field cannot be changed."))
			return
		case dataErr.IsObjectionable():
			// The word filter (public.refuse_objectionable_text) refused a
			// username, display name or bio. The wording is ours.
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
				"That has words our community rules don't allow. Change it and try again."))
			return
		case dataErr.IsUniqueViolation():
			// The only unique-writable column on this table is the username, so
			// a conflict here always names it — and the form shows it under the
			// input it belongs to instead of as a concurrency error.
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeConflict, "That username is taken.",
				apierr.Detail{Field: "username", Rule: "taken"}))
			return
		case dataErr.IsConstraintViolation():
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable, "Check the details you entered and try again."))
			return
		}
	}

	s.logger.ErrorContext(r.Context(), "profile call failed",
		slog.String("operation", operation),
		slog.Any("error", err),
	)
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable, "Profiles are not available right now."))
}

// ── Wiring ──────────────────────────────────────────────────────────────────

// Options returns the wiring every users entrypoint runs.
func Options() servicekit.Options {
	return servicekit.Options{
		Name: Name,
		// RegisterWith runs after the standard wiring, so these handlers and the
		// middleware share one verifier: the token a request was authenticated
		// with is the token the profile call is made with.
		RegisterWith: func(router *httpx.Router, cfg *config.Config, logger *slog.Logger, _ *authn.Verifier) {
			var backend Backend
			client, err := supabaseprofile.New(cfg)
			if err != nil {
				// Booting anyway is deliberate: the service still serves its
				// probes and answers 503 on the profile routes, which is far more
				// diagnosable than a crash loop. The error names the missing
				// variables and carries no value.
				logger.Warn("Supabase profiles are not configured; the profile routes answer 503",
					slog.Any("error", err))
			} else {
				backend = client
			}
			newService(backend, logger).withAvatars(avatarPipelineFromEnv(cfg, logger)).register(router)
		},
	}
}
