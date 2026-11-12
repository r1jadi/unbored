package users

import (
	"bytes"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"github.com/r1jadi/unbored/packages/go/platform/apierr"
	"github.com/r1jadi/unbored/packages/go/platform/config"
	"github.com/r1jadi/unbored/packages/go/platform/httpx"
	"github.com/r1jadi/unbored/services/users/internal/avatarscreen"
	"github.com/r1jadi/unbored/services/users/internal/avatarstore"
)

// AvatarPath screens and publishes a new profile picture.
//
// The browser first uploads the picture to the private `avatar-uploads` bucket,
// under its own folder, then posts the object's path here. The picture is shown
// to nobody until it has passed OpenAI's moderation check: only then is it copied
// into the public `avatars` bucket and set on the profile. A refused picture is
// deleted and answered with a 422 the screen can show as it is.
const AvatarPath = "/api/v1/users/me/avatar"

// maxAvatarRequestBytes bounds the JSON body: it carries one short path.
const maxAvatarRequestBytes = 1 << 10

// pictureTypes are the formats both buckets accept, and how each one starts.
var pictureTypes = map[string][]byte{
	"image/png":  {0x89, 'P', 'N', 'G'},
	"image/jpeg": {0xFF, 0xD8, 0xFF},
	"image/webp": []byte("RIFF"),
}

type avatarRequest struct {
	// UploadPath is the object's path in the holding bucket: <account id>/<file>.
	UploadPath string `json:"uploadPath"`
}

// avatarPipeline is the screening and publishing the route needs.
type avatarPipeline struct {
	store    avatarstore.Store
	screener avatarscreen.Screener
}

// withAvatars turns the upload route on. A nil pipeline leaves it answering 503.
func (s *service) withAvatars(pipeline *avatarPipeline) *service {
	s.avatars = pipeline
	return s
}

// avatarPipelineFromEnv builds the pipeline from the deployment's keys, or
// returns nil — logging which piece is missing, never a value — when either is
// absent. Without it the route refuses every picture rather than publishing one
// unscreened: failing closed is the point of the route.
func avatarPipelineFromEnv(cfg *config.Config, logger *slog.Logger) *avatarPipeline {
	store, err := avatarstore.New(cfg)
	if err != nil {
		logger.Warn("profile picture uploads are off: the Supabase secret key is missing", slog.Any("error", err))
		return nil
	}
	screener, err := avatarscreen.New(os.Getenv("OPENAI_API_KEY"), os.Getenv("OPENAI_MODERATION_MODEL"))
	if err != nil {
		logger.Warn("profile picture uploads are off: OPENAI_API_KEY is missing", slog.Any("error", err))
		return nil
	}
	return &avatarPipeline{store: store, screener: screener}
}

func (s *service) uploadAvatar(w http.ResponseWriter, r *http.Request) {
	user, ok := caller(w, r)
	if !ok {
		return
	}

	var request avatarRequest
	if err := httpx.DecodeJSON(w, r, maxAvatarRequestBytes, &request); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	path := strings.TrimSpace(request.UploadPath)
	// The path must be this account's own folder: the token decides, not the body.
	if !avatarPathPattern.MatchString(path) || !strings.HasPrefix(path, user.UserID+"/") {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Upload the picture to your own folder first.",
			apierr.Detail{Field: "uploadPath", Rule: "format"}))
		return
	}
	if s.avatars == nil || s.backend == nil {
		s.logger.WarnContext(r.Context(), "users dependency is not configured",
			slog.String("operation", "upload a profile picture"))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
			"Photo uploads aren't available right now. Try again later."))
		return
	}
	ctx := r.Context()
	store := s.avatars.store

	// Whatever happens next, the holding copy is not needed afterwards.
	defer func() {
		if err := store.Remove(ctx, avatarstore.HoldingBucket, path); err != nil {
			s.logger.WarnContext(ctx, "could not clear a held picture", slog.Any("error", err))
		}
	}()

	picture, contentType, err := store.Fetch(ctx, path)
	if err != nil {
		if err == avatarstore.ErrNotFound {
			httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
				"That picture didn't finish uploading. Try again.",
				apierr.Detail{Field: "uploadPath", Rule: "missing"}))
			return
		}
		s.avatarFailure(w, r, "fetch a held picture", err)
		return
	}
	magic, known := pictureTypes[contentType]
	if !known || !bytes.HasPrefix(picture, magic) {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"Choose a PNG, JPEG or WebP image.",
			apierr.Detail{Field: "uploadPath", Rule: "type"}))
		return
	}
	if len(picture) > avatarstore.MaxPictureBytes {
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That image is larger than 2 MB.",
			apierr.Detail{Field: "uploadPath", Rule: "size"}))
		return
	}

	verdict, err := s.avatars.screener.Screen(ctx, picture, contentType)
	if err != nil {
		// No verdict means no publishing.
		s.avatarFailure(w, r, "screen a picture", err)
		return
	}
	if verdict.Flagged {
		s.logger.InfoContext(ctx, "a profile picture was refused by screening",
			slog.String("user", user.UserID), slog.Any("categories", verdict.Categories))
		httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnprocessable,
			"That picture isn't allowed. Choose a different one.",
			apierr.Detail{Field: "uploadPath", Rule: "objectionable"}))
		return
	}

	// The previous picture, to delete once the new one is in place.
	previous, _, _ := s.backend.GetProfile(ctx, bearer(r), user.UserID)

	if err := store.Publish(ctx, path, picture, contentType); err != nil {
		s.avatarFailure(w, r, "publish a picture", err)
		return
	}
	if err := store.SetAvatarPath(ctx, user.UserID, path); err != nil {
		_ = store.Remove(ctx, avatarstore.PublicBucket, path)
		s.avatarFailure(w, r, "set a profile picture", err)
		return
	}
	if previous.AvatarPath != nil && *previous.AvatarPath != "" && *previous.AvatarPath != path {
		if err := store.Remove(ctx, avatarstore.PublicBucket, *previous.AvatarPath); err != nil {
			s.logger.WarnContext(ctx, "could not delete a replaced picture", slog.Any("error", err))
		}
	}

	profile, found, err := s.backend.GetProfile(ctx, bearer(r), user.UserID)
	if err != nil || !found {
		s.avatarFailure(w, r, "read the profile back", err)
		return
	}
	httpx.WriteJSON(w, r, http.StatusOK, view(profile, user.Role))
}

// avatarFailure answers a failure the player can only retry. The cause is logged,
// never sent.
func (s *service) avatarFailure(w http.ResponseWriter, r *http.Request, operation string, err error) {
	s.logger.ErrorContext(r.Context(), "profile picture upload failed",
		slog.String("operation", operation), slog.Any("error", err))
	httpx.WriteError(w, r, httpx.NewError(httpx.CodeUnavailable,
		"Your picture couldn't be saved right now. Try again."))
}
