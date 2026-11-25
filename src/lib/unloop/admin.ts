/**
 * Unloop for administrators: the publishing API (`services/admin/unloop.go`).
 *
 * Authorization is the server's: every call carries the caller's own token and the
 * API re-checks the ADMIN_EMAILS allowlist per request. Nothing here sends a role.
 *
 * Files never pass through the API. The admin service mints a one-time upload URL
 * for a path it chooses, and the browser sends the file straight to storage, with
 * progress — a video is far larger than the API's request limit.
 */

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { publicConfig } from "@/lib/config";
import { useResource } from "@/lib/admin/api";
import { t } from "@/lib/settings/language";
import type { UnloopCategory } from "@/lib/unloop/categories";

const Routes = {
  videos: "/admin/unloop/videos",
  video: (id: string) => `/admin/unloop/videos/${id}`,
  uploads: "/admin/unloop/uploads",
} as const;

export const UNLOOP_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const UNLOOP_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
/** The bucket's own limit (supabase/migrations/20270123120000_unloop.sql). */
export const UNLOOP_MAX_BYTES = 100 * 1024 * 1024;
export const UNLOOP_MAX_SECONDS = 600;

export type UnloopStatus = "draft" | "published";

export type AdminUnloopVideo = {
  id: string;
  title: string;
  description: string;
  category: UnloopCategory;
  videoPath: string;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  status: UnloopStatus;
  createdByUsername: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  likes: number;
  saves: number;
};

export type AdminUnloopInput = {
  title: string;
  description: string;
  category: UnloopCategory;
  videoPath: string;
  thumbnailPath: string | null;
  durationSeconds: number | null;
  status: UnloopStatus;
};

function requireToken(): string {
  const token = getAccessToken();
  if (!token) throw new ApiError(t("Sign in to continue."), { code: "unauthorized", status: 401 });
  return token;
}

export async function fetchAdminUnloopVideos(
  status: UnloopStatus | undefined,
  signal?: AbortSignal,
): Promise<{ items: AdminUnloopVideo[]; hasMore: boolean }> {
  return apiFetch(Routes.videos, {
    token: requireToken(),
    query: { status, limit: 100 },
    signal,
  });
}

export function useAdminUnloopVideos(status?: UnloopStatus) {
  return useResource((signal) => fetchAdminUnloopVideos(status, signal), [status]);
}

export async function createUnloopVideo(
  input: AdminUnloopInput,
): Promise<{ id: string; status: UnloopStatus }> {
  return apiFetch(Routes.videos, { method: "POST", token: requireToken(), body: input });
}

export async function updateUnloopVideo(
  id: string,
  input: AdminUnloopInput,
): Promise<{ id: string; status: UnloopStatus }> {
  return apiFetch(Routes.video(id), { method: "PATCH", token: requireToken(), body: input });
}

export async function deleteUnloopVideo(id: string): Promise<{ id: string }> {
  return apiFetch(Routes.video(id), { method: "DELETE", token: requireToken() });
}

/**
 * Uploads one file: asks the API for a path and a one-time URL, then sends the
 * bytes to storage. Resolves with the path the video row should name.
 */
export async function uploadUnloopFile(
  kind: "video" | "thumbnail",
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const accepted: readonly string[] = kind === "video" ? UNLOOP_VIDEO_TYPES : UNLOOP_IMAGE_TYPES;
  if (!accepted.includes(file.type)) {
    throw new ApiError(
      kind === "video"
        ? t("A video must be MP4, WebM or MOV.")
        : t("A thumbnail must be JPEG, PNG or WebP."),
      { code: "unsupported_type" },
    );
  }
  if (file.size > UNLOOP_MAX_BYTES) {
    throw new ApiError(t("That file is over 100 MB."), { code: "too_large" });
  }

  const { path, uploadUrl } = await apiFetch<{ path: string; uploadUrl: string }>(Routes.uploads, {
    method: "POST",
    token: requireToken(),
    body: { kind, contentType: file.type },
    signal,
  });

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", file.type);
    request.setRequestHeader("x-upsert", "false");
    // What Supabase's own client sends: the gateway identifies the project by it.
    if (publicConfig.supabase.publishableKey) {
      request.setRequestHeader("apikey", publicConfig.supabase.publishableKey);
    }
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress?.(1);
        resolve();
      } else {
        reject(storageUploadError(request.status, request.responseText));
      }
    };
    request.onerror = () =>
      reject(
        new ApiError(t("The upload didn't go through. Try again."), { code: "upload_failed" }),
      );
    request.onabort = () =>
      reject(new ApiError(t("Upload cancelled."), { code: "upload_cancelled" }));
    signal?.addEventListener("abort", () => request.abort(), { once: true });
    request.send(file);
  });
  return path;
}

/**
 * Explains a refused upload. Supabase Storage answers most refusals with HTTP 400
 * and the real status in the body (`{"statusCode":"413","error":"Payload too large"}`),
 * so the body, not the HTTP status, says what went wrong.
 */
export function storageUploadError(status: number, body: string): ApiError {
  let code = String(status);
  let detail = "";
  try {
    const parsed = JSON.parse(body) as { statusCode?: unknown; error?: unknown; message?: unknown };
    if (parsed.statusCode !== undefined) code = String(parsed.statusCode);
    detail = [parsed.error, parsed.message].filter((part) => typeof part === "string").join(": ");
  } catch {
    // Not JSON: the HTTP status is all there is.
  }
  if (code === "413" || /too large|maximum allowed size/i.test(detail)) {
    return new ApiError(
      t(
        "That file is bigger than this project's upload limit. Raise the global file size limit in Supabase (Storage → Settings), or upload a smaller file.",
      ),
      { code: "too_large", status },
    );
  }
  if (code === "415" || /mime|content type/i.test(detail)) {
    return new ApiError(t("Storage refused this file type. Use MP4, WebM or MOV."), {
      code: "unsupported_type",
      status,
    });
  }
  if (code === "409" || /already exists|duplicate/i.test(detail)) {
    return new ApiError(t("The upload didn't go through. Try again."), {
      code: "upload_conflict",
      status,
    });
  }
  if (code === "403" || code === "401" || /signature|jwt|token|expired/i.test(detail)) {
    return new ApiError(t("The upload link expired. Choose the file again."), {
      code: "upload_expired",
      status,
    });
  }
  return new ApiError(
    detail
      ? t("Storage refused the upload: {reason}", { reason: detail })
      : t("The upload didn't go through. Try again."),
    { code: "upload_failed", status },
  );
}

/** Reads a video file's length in the browser, or null when it can't be read. */
export function readVideoDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "metadata";
    video.muted = true;
    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? Math.round(video.duration * 100) / 100 : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * A still from the video, as a JPEG, for an administrator who has no thumbnail of
 * their own. Taken a moment in, past any black opening frame.
 */
export function captureVideoFrame(file: File, atSeconds = 1): Promise<File | null> {
  return new Promise((resolve) => {
    if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    const done = (value: File | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      video.currentTime = Math.min(atSeconds, Math.max(0, (video.duration || 0) / 3));
    };
    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context || canvas.width === 0) {
        done(null);
        return;
      }
      context.drawImage(video, 0, 0);
      canvas.toBlob(
        (blob) => done(blob ? new File([blob], "thumbnail.jpg", { type: "image/jpeg" }) : null),
        "image/jpeg",
        0.86,
      );
    };
    video.onerror = () => done(null);
    video.src = url;
  });
}
