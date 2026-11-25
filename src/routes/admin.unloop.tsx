import { Link, createFileRoute } from "@tanstack/react-router";
import {
  Camera,
  Eye,
  EyeOff,
  Film,
  ImagePlus,
  Pencil,
  Plus,
  Send,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { toast } from "sonner";

import {
  AdminListStates,
  AdminPage,
  ConfirmDialog,
  SectionCard,
  StatCard,
  StatusBadge,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { UnloopWordmark } from "@/components/unloop/UnloopMarks";
import { asApiError, formatWhen, useAdminSession } from "@/lib/admin/api";
import { fmt } from "@/lib/format";
import { t } from "@/lib/settings/language";
import { UNLOOP_CATEGORIES, unloopCategory, type UnloopCategory } from "@/lib/unloop/categories";
import {
  UNLOOP_IMAGE_TYPES,
  UNLOOP_MAX_SECONDS,
  UNLOOP_VIDEO_TYPES,
  captureVideoFrame,
  createUnloopVideo,
  deleteUnloopVideo,
  readVideoDuration,
  updateUnloopVideo,
  uploadUnloopFile,
  useAdminUnloopVideos,
  type AdminUnloopVideo,
  type UnloopStatus,
} from "@/lib/unloop/admin";
import { unloopFileUrl } from "@/lib/unloop/feed";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/unloop")({
  head: () => ({
    meta: [{ title: t("Unloop — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: UnloopAdmin,
});

const FIELD =
  "w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/** One file on its way to storage. `path` is set once it has arrived. */
type Upload = {
  status: "idle" | "uploading" | "done" | "error";
  progress: number;
  path: string | null;
  /** What the preview shows: a local blob, or the stored file. */
  previewUrl: string | null;
};

const NO_UPLOAD: Upload = { status: "idle", progress: 0, path: null, previewUrl: null };

type Draft = {
  id: string | null;
  title: string;
  description: string;
  category: UnloopCategory;
  durationSeconds: number | null;
  video: Upload;
  thumbnail: Upload;
};

const EMPTY: Draft = {
  id: null,
  title: "",
  description: "",
  category: "highlights",
  durationSeconds: null,
  video: NO_UPLOAD,
  thumbnail: NO_UPLOAD,
};

function fromVideo(video: AdminUnloopVideo): Draft {
  return {
    id: video.id,
    title: video.title,
    description: video.description,
    category: video.category,
    durationSeconds: video.durationSeconds,
    video: {
      status: "done",
      progress: 1,
      path: video.videoPath,
      previewUrl: unloopFileUrl(video.videoPath),
    },
    thumbnail: video.thumbnailPath
      ? {
          status: "done",
          progress: 1,
          path: video.thumbnailPath,
          previewUrl: unloopFileUrl(video.thumbnailPath),
        }
      : NO_UPLOAD,
  };
}

/**
 * Unloop's studio: upload a loop, give it a title, a description, a channel and a
 * thumbnail, then publish it or keep it as a draft. Only administrators publish;
 * the API refuses everyone else whatever this screen shows.
 */
function UnloopAdmin() {
  const session = useAdminSession();
  const isAdmin = session.status === "ready" && session.data.isAdmin;
  const [filter, setFilter] = useState<UnloopStatus | undefined>(undefined);
  const library = useAdminUnloopVideos(isAdmin ? filter : undefined);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [removing, setRemoving] = useState<AdminUnloopVideo | null>(null);
  // A fresh composer after each save, cancel or edit.
  const [round, setRound] = useState(0);
  const load = (next: Draft) => {
    setDraft(next);
    setRound((value) => value + 1);
  };
  const composer = useRef<HTMLDivElement>(null);

  if (session.status === "loading") {
    return (
      <AdminPage title={t("Unloop")}>
        <p className="text-sm text-muted-foreground">{t("Loading…")}</p>
      </AdminPage>
    );
  }
  if (!isAdmin) {
    return (
      <AdminPage title={t("Unloop")} subtitle={t("Short videos for everyone on Unbored.")}>
        <SectionCard>
          <p className="text-sm text-muted-foreground">
            {t("Publishing Unloop videos requires an administrator.")}
          </p>
        </SectionCard>
      </AdminPage>
    );
  }

  const rows = library.status === "ready" ? library.data.items : [];

  function edit(video: AdminUnloopVideo) {
    load(fromVideo(video));
    composer.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  async function setStatus(video: AdminUnloopVideo, status: UnloopStatus) {
    try {
      await updateUnloopVideo(video.id, {
        title: video.title,
        description: video.description,
        category: video.category,
        videoPath: video.videoPath,
        thumbnailPath: video.thumbnailPath,
        durationSeconds: video.durationSeconds,
        status,
      });
      toast.success(
        status === "published" ? t("Published to Unloop.") : t("Moved back to drafts."),
      );
      library.retry();
    } catch (error) {
      toast.error(asApiError(error).message);
    }
  }

  async function remove(video: AdminUnloopVideo) {
    try {
      await deleteUnloopVideo(video.id);
      toast.success(t("Deleted."));
      if (draft.id === video.id) load(EMPTY);
      library.retry();
    } catch (error) {
      toast.error(asApiError(error).message);
    } finally {
      setRemoving(null);
    }
  }

  return (
    <AdminPage
      title={t("Unloop")}
      subtitle={t("Upload, publish and manage the short videos everyone can watch in Unloop.")}
      actions={
        <Button asChild variant="secondary" size="sm">
          <Link to="/unloop">
            <Eye /> {t("Open Unloop")}
          </Link>
        </Button>
      }
    >
      <div className="space-y-4 md:space-y-5">
        {library.status === "ready" && <LibraryStats rows={rows} filtered={filter !== undefined} />}

        <div ref={composer} className="scroll-mt-24">
          <Composer
            key={round}
            initial={draft}
            onCancel={() => load(EMPTY)}
            onSaved={() => {
              load(EMPTY);
              library.retry();
            }}
          />
        </div>

        <SectionCard
          title={t("Library")}
          bodyClassName="p-0"
          action={
            <div
              className="flex gap-1 rounded-full bg-surface-2 p-1"
              role="group"
              aria-label={t("Filter")}
            >
              {(
                [
                  [undefined, t("All")],
                  ["published", t("Published")],
                  ["draft", t("Drafts")],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setFilter(value)}
                  aria-pressed={filter === value}
                  className={cn(
                    "press rounded-full px-3 py-1 text-xs",
                    filter === value
                      ? "bg-foreground font-medium text-background"
                      : "text-muted-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          }
        >
          {library.status === "error" ? (
            <AdminListStates
              state="error"
              onRetry={library.retry}
              emptyTitle=""
              emptyBody={library.error.message}
            />
          ) : library.status === "loading" ? (
            <AdminListStates state="loading" emptyTitle="" rows={3} />
          ) : rows.length === 0 ? (
            <AdminListStates
              state="ready"
              emptyTitle={t("No loops yet")}
              emptyBody={t("Upload a video above. It appears here as a draft or published loop.")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((video) => (
                <LibraryRow
                  key={video.id}
                  video={video}
                  onEdit={() => edit(video)}
                  onPublish={() =>
                    void setStatus(video, video.status === "published" ? "draft" : "published")
                  }
                  onDelete={() => setRemoving(video)}
                />
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t("Delete this loop?")}
        description={t(
          "It disappears from Unloop with its likes and saves, and its files are removed. This can't be undone.",
        )}
        confirmLabel={t("Delete")}
        destructive
        onConfirm={() => removing && void remove(removing)}
      />
    </AdminPage>
  );
}

function LibraryStats({ rows, filtered }: { rows: AdminUnloopVideo[]; filtered: boolean }) {
  const published = rows.filter((row) => row.status === "published").length;
  const likes = rows.reduce((sum, row) => sum + row.likes, 0);
  const saves = rows.reduce((sum, row) => sum + row.saves, 0);
  if (filtered) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <StatCard label={t("Published")} value={fmt(published)} />
      <StatCard label={t("Drafts")} value={fmt(rows.length - published)} />
      <StatCard label={t("Likes")} value={fmt(likes)} />
      <StatCard label={t("Saves")} value={fmt(saves)} />
    </div>
  );
}

function LibraryRow({
  video,
  onEdit,
  onPublish,
  onDelete,
}: {
  video: AdminUnloopVideo;
  onEdit: () => void;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const category = unloopCategory(video.category);
  const published = video.status === "published";
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div
        className="relative aspect-[9/16] w-12 shrink-0 overflow-hidden rounded-lg bg-surface-2"
        style={{ boxShadow: `inset 0 0 0 1px oklch(0.78 0.16 ${category.hue} / 0.5)` }}
      >
        {video.thumbnailPath ? (
          <img
            src={unloopFileUrl(video.thumbnailPath)}
            alt=""
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <Film className="absolute inset-0 m-auto size-5 text-muted-foreground" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{video.title}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>
            <category.icon className="mr-1 inline size-3 align-[-1px]" aria-hidden />
            {t(category.label)}
          </span>
          <StatusBadge tone={published ? "success" : "muted"}>
            {published ? t("Published") : t("Draft")}
          </StatusBadge>
          {published && (
            <span className="tabular">
              {t("{likes} likes · {saves} saves", {
                likes: fmt(video.likes),
                saves: fmt(video.saves),
              })}
            </span>
          )}
          <span>{formatWhen(video.updatedAt)}</span>
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {published && (
          <Button asChild variant="ghost" size="icon" aria-label={t("Watch in Unloop")}>
            <Link to="/unloop" search={{ v: video.id }}>
              <Eye />
            </Link>
          </Button>
        )}
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={t("Edit")}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onPublish}
          aria-label={published ? t("Unpublish") : t("Publish")}
        >
          {published ? <EyeOff /> : <Send />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label={t("Delete")}>
          <Trash2 className="text-destructive" />
        </Button>
      </div>
    </li>
  );
}

function Composer({
  initial,
  onCancel,
  onSaved,
}: {
  initial: Draft;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState<UnloopStatus | null>(null);
  const preview = useRef<HTMLVideoElement>(null);
  const videoInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const blobs = useRef<string[]>([]);
  const editing = initial.id !== null;

  useEffect(() => () => blobs.current.forEach((url) => URL.revokeObjectURL(url)), []);

  const blob = (file: File) => {
    const url = URL.createObjectURL(file);
    blobs.current.push(url);
    return url;
  };

  const patch = (next: Partial<Draft>) => setDraft((current) => ({ ...current, ...next }));

  async function sendThumbnail(file: File) {
    setDraft((current) => ({
      ...current,
      thumbnail: { status: "uploading", progress: 0, path: null, previewUrl: blob(file) },
    }));
    try {
      const path = await uploadUnloopFile("thumbnail", file, (progress) =>
        setDraft((current) => ({ ...current, thumbnail: { ...current.thumbnail, progress } })),
      );
      setDraft((current) => ({
        ...current,
        thumbnail: { ...current.thumbnail, status: "done", progress: 1, path },
      }));
    } catch (error) {
      setDraft((current) => ({ ...current, thumbnail: { ...current.thumbnail, status: "error" } }));
      toast.error(asApiError(error).message);
    }
  }

  async function chooseVideo(file: File) {
    const seconds = await readVideoDuration(file);
    if (seconds !== null && seconds > UNLOOP_MAX_SECONDS) {
      toast.error(t("A loop is at most 10 minutes long."));
      return;
    }
    const hadThumbnail = draft.thumbnail.status !== "idle";
    setDraft((current) => ({
      ...current,
      durationSeconds: seconds,
      title:
        current.title ||
        file.name
          .replace(/\.[^.]+$/, "")
          .replace(/[-_]+/g, " ")
          .slice(0, 80),
      video: { status: "uploading", progress: 0, path: null, previewUrl: blob(file) },
    }));
    // A picture straight away, until the administrator picks a better one.
    if (!hadThumbnail) {
      void captureVideoFrame(file).then((frame) => frame && void sendThumbnail(frame));
    }
    try {
      const path = await uploadUnloopFile("video", file, (progress) =>
        setDraft((current) => ({ ...current, video: { ...current.video, progress } })),
      );
      setDraft((current) => ({
        ...current,
        video: { ...current.video, status: "done", progress: 1, path },
      }));
    } catch (error) {
      setDraft((current) => ({ ...current, video: { ...current.video, status: "error" } }));
      toast.error(asApiError(error).message);
    }
  }

  // The frame the preview is paused on, as the thumbnail.
  async function takeCurrentFrame() {
    const player = preview.current;
    if (!player || player.videoWidth === 0) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = player.videoWidth;
      canvas.height = player.videoHeight;
      canvas.getContext("2d")?.drawImage(player, 0, 0);
      const file = await new Promise<File | null>((resolve) =>
        canvas.toBlob(
          (data) => resolve(data ? new File([data], "frame.jpg", { type: "image/jpeg" }) : null),
          "image/jpeg",
          0.86,
        ),
      );
      if (file) await sendThumbnail(file);
    } catch {
      toast.error(t("Couldn't take a frame from this video. Choose an image instead."));
    }
  }

  const titleLength = draft.title.trim().length;
  const uploading = draft.video.status === "uploading" || draft.thumbnail.status === "uploading";
  const problem =
    draft.video.path === null
      ? t("Upload a video to continue.")
      : uploading
        ? t("Waiting for the upload to finish…")
        : titleLength < 2
          ? t("Give it a title.")
          : null;

  async function save(status: UnloopStatus) {
    if (problem || busy || !draft.video.path) return;
    setBusy(status);
    const input = {
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      videoPath: draft.video.path,
      thumbnailPath: draft.thumbnail.status === "done" ? draft.thumbnail.path : null,
      durationSeconds: draft.durationSeconds,
      status,
    };
    try {
      if (draft.id) await updateUnloopVideo(draft.id, input);
      else await createUnloopVideo(input);
      toast.success(status === "published" ? t("Published to Unloop.") : t("Saved as a draft."));
      onSaved();
    } catch (error) {
      toast.error(asApiError(error).message);
    } finally {
      setBusy(null);
    }
  }

  const category = unloopCategory(draft.category);
  const hue = useMemo(
    () => ({ "--loop-hue": String(category.hue) }) as CSSProperties,
    [category.hue],
  );

  return (
    <SectionCard
      title={editing ? t("Edit loop") : t("New loop")}
      action={
        editing ? (
          <Button variant="ghost" size="sm" onClick={onCancel}>
            <X /> {t("Cancel")}
          </Button>
        ) : (
          <span className="text-muted-foreground">
            <UnloopWordmark className="text-sm" />
          </span>
        )
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
        {/* The phone-shaped preview: exactly what a viewer gets. */}
        <div className="mx-auto w-full max-w-[240px]" style={hue}>
          <div className="unloop-frame relative aspect-[9/16] overflow-hidden rounded-[1.5rem] bg-black">
            {draft.video.previewUrl ? (
              <video
                ref={preview}
                src={draft.video.previewUrl}
                poster={draft.thumbnail.previewUrl ?? undefined}
                crossOrigin={draft.video.previewUrl.startsWith("blob:") ? undefined : "anonymous"}
                className="absolute inset-0 size-full object-cover"
                controls
                playsInline
                loop
                muted
              />
            ) : (
              <button
                type="button"
                onClick={() => videoInput.current?.click()}
                className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center text-white/80 hover:bg-white/5"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-white/10">
                  <Upload className="size-6" />
                </span>
                <span className="text-sm font-medium">{t("Choose a video")}</span>
                <span className="text-xs text-white/55">
                  {t("MP4, WebM or MOV · up to 100 MB · vertical works best")}
                </span>
              </button>
            )}
            {draft.video.status === "uploading" && (
              <UploadBar label={t("Uploading video")} progress={draft.video.progress} />
            )}
          </div>
          <input
            ref={videoInput}
            type="file"
            accept={UNLOOP_VIDEO_TYPES.join(",")}
            className="sr-only"
            aria-label={t("Video file")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void chooseVideo(file);
            }}
          />
          {draft.video.previewUrl && (
            <Button
              variant="secondary"
              size="sm"
              className="mt-2 w-full"
              onClick={() => videoInput.current?.click()}
              disabled={draft.video.status === "uploading"}
            >
              <Film /> {t("Replace video")}
            </Button>
          )}
          {draft.video.status === "error" && (
            <p role="alert" className="mt-2 text-xs text-destructive">
              {t("The upload didn't go through. Try again.")}
            </p>
          )}
        </div>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save("published");
          }}
        >
          <label className="block space-y-1.5">
            <span className="flex items-baseline justify-between text-sm font-medium">
              {t("Title")}
              <span className="text-xs font-normal text-muted-foreground tabular">
                {draft.title.length}/80
              </span>
            </span>
            <input
              className={FIELD}
              value={draft.title}
              maxLength={80}
              onChange={(event) => patch({ title: event.target.value })}
              placeholder={t("What happens in this loop?")}
            />
          </label>

          <label className="block space-y-1.5">
            <span className="flex items-baseline justify-between text-sm font-medium">
              {t("Description")}
              <span className="text-xs font-normal text-muted-foreground tabular">
                {draft.description.length}/500
              </span>
            </span>
            <textarea
              className={cn(FIELD, "min-h-24 resize-y")}
              value={draft.description}
              maxLength={500}
              onChange={(event) => patch({ description: event.target.value })}
              placeholder={t("Optional. A line or two of context.")}
            />
          </label>

          <fieldset className="space-y-1.5">
            <legend className="text-sm font-medium">{t("Channel")}</legend>
            <div className="flex flex-wrap gap-1.5 pt-1.5">
              {UNLOOP_CATEGORIES.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => patch({ category: option.slug })}
                  aria-pressed={draft.category === option.slug}
                  data-active={draft.category === option.slug || undefined}
                  style={{ "--loop-hue": String(option.hue) } as CSSProperties}
                  className="unloop-chip flex items-center gap-1 rounded-full bg-surface-2 px-3 py-1.5 text-xs font-medium text-muted-foreground"
                >
                  <option.icon className="size-3" aria-hidden /> {t(option.label)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("Thumbnail")}</p>
            <div className="flex items-start gap-3">
              <div className="relative aspect-[9/16] w-20 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {draft.thumbnail.previewUrl ? (
                  <img
                    src={draft.thumbnail.previewUrl}
                    alt={t("Thumbnail")}
                    className="size-full object-cover"
                  />
                ) : (
                  <ImagePlus className="absolute inset-0 m-auto size-5 text-muted-foreground" />
                )}
                {draft.thumbnail.status === "uploading" && (
                  <UploadBar label={t("Uploading thumbnail")} progress={draft.thumbnail.progress} />
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => imageInput.current?.click()}
                >
                  <ImagePlus /> {t("Choose image")}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={!draft.video.previewUrl}
                  onClick={() => void takeCurrentFrame()}
                >
                  <Camera /> {t("Use current frame")}
                </Button>
                {draft.thumbnail.status !== "idle" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => patch({ thumbnail: NO_UPLOAD })}
                  >
                    <X /> {t("Remove")}
                  </Button>
                )}
                <p className="w-full text-xs text-muted-foreground">
                  {t(
                    "Shown while a loop loads and in shared links. Pause the preview on a frame you like.",
                  )}
                </p>
              </div>
              <input
                ref={imageInput}
                type="file"
                accept={UNLOOP_IMAGE_TYPES.join(",")}
                className="sr-only"
                aria-label={t("Thumbnail image")}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void sendThumbnail(file);
                }}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <Button type="submit" disabled={problem !== null || busy !== null}>
              {editing ? <Send /> : <Plus />}
              {busy === "published"
                ? t("Publishing…")
                : editing
                  ? t("Save and publish")
                  : t("Publish")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={problem !== null || busy !== null}
              onClick={() => void save("draft")}
            >
              {busy === "draft" ? t("Saving…") : t("Save as draft")}
            </Button>
            {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
          </div>
        </form>
      </div>
    </SectionCard>
  );
}

function UploadBar({ label, progress }: { label: string; progress: number }) {
  const percent = Math.round(progress * 100);
  return (
    <div
      className="absolute inset-x-2 bottom-2"
      role="progressbar"
      aria-label={label}
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
