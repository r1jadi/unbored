import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Send, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminListStates, AdminPage, SectionCard, StatCard } from "@/components/admin/ui";
import { AnnouncementCard } from "@/components/notifications/AnnouncementCard";
import { Button } from "@/components/ui/button";
import {
  asApiError,
  deleteAdminBroadcast,
  formatStamp,
  internalLink,
  sendAdminBroadcast,
  updateAdminBroadcast,
  type AdminBroadcast,
  type AdminBroadcastMessage,
  type AdminGame,
  useAdminBroadcasts,
  useAdminGames,
  useAdminSession,
} from "@/lib/admin/api";
import {
  ANNOUNCEMENT_ACTIONS,
  ANNOUNCEMENT_STYLES,
  type AnnouncementAction,
  type AnnouncementStyle,
} from "@/lib/notifications/announcement-styles";
import type { Announcement } from "@/lib/notifications/store";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/notifications")({
  head: () => ({
    meta: [{ title: t("Notifications — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: NotificationsAdmin,
});

const FIELD =
  "w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * Announcements to every player who hasn't opted out in Settings. Each writes one row
 * per player into the inbox and pushes to devices that allow it. The numbers are real:
 * recipients is how many rows were written, and read is how many have been opened.
 * Sends immediately; there are no drafts or schedules. An administrator can edit or
 * delete one afterwards, which changes or removes it in every inbox too.
 *
 * An announcement is built from the same parts as the notifications Unbored sends by
 * itself (a label with an icon, a picture, a button), and the form previews it with
 * the inbox's own card.
 */
function NotificationsAdmin() {
  const session = useAdminSession();
  const history = useAdminBroadcasts({ limit: 50, offset: 0 });
  const isAdmin = session.status === "ready" && session.data.isAdmin;
  const games = usePublishedGames();

  const [draft, setDraft] = useState<AdminBroadcastMessage>(EMPTY);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = draftProblem(draft) === null;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const result = await sendAdminBroadcast(finished(draft));
      toast.success(t("Sent to {n} players.", { n: result.recipients }));
      setDraft(EMPTY);
      history.retry();
    } catch (error) {
      toast.error(asApiError(error).message);
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const rows = history.status === "ready" ? history.data.items : [];

  return (
    <AdminPage
      title={t("Notifications")}
      subtitle={t("Messages sent to players, and the campaigns that produce them.")}
    >
      <div className="space-y-4 md:space-y-5">
        <SectionCard title={t("New announcement")} bodyClassName="p-4">
          {isAdmin ? (
            <form className="space-y-3" onSubmit={(e) => void send(e)}>
              <AnnouncementFields
                value={draft}
                games={games}
                onChange={(next) => {
                  setDraft(next);
                  setConfirming(false);
                }}
              />
              {confirming && (
                <p role="alert" className="text-sm text-warning">
                  {t(
                    "This goes to every player right away and can't be taken back. Send it again to confirm.",
                  )}
                </p>
              )}
              <Button
                type="submit"
                size="sm"
                variant={confirming ? "destructive" : "default"}
                disabled={!valid || busy}
              >
                <Send />
                {confirming ? t("Yes, send to everyone") : t("Send")}
              </Button>
            </form>
          ) : (
            <p className="text-sm text-muted-foreground">
              {session.status === "loading"
                ? t("Loading…")
                : t("Sending announcements requires an administrator.")}
            </p>
          )}
        </SectionCard>

        <SectionCard title={t("Sent")} bodyClassName="p-0">
          {history.status === "error" ? (
            <AdminListStates
              state="error"
              onRetry={history.retry}
              emptyTitle=""
              emptyBody={history.error.message}
            />
          ) : history.status === "loading" ? (
            <AdminListStates state="loading" emptyTitle="" rows={3} />
          ) : rows.length === 0 ? (
            <AdminListStates
              state="ready"
              emptyTitle={t("Nothing sent yet")}
              emptyBody={t("Announcements appear here once they go out.")}
            />
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => (
                <SentRow
                  key={row.id}
                  row={row}
                  games={games}
                  canManage={isAdmin}
                  onChanged={history.retry}
                />
              ))}
            </ul>
          )}
        </SectionCard>

        {rows[0] && (
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label={t("Last sent to")} value={String(rows[0].recipients)} />
            <StatCard label={t("Last read by")} value={String(rows[0].readCount)} />
          </div>
        )}
      </div>
    </AdminPage>
  );
}

/** One sent announcement, as players see it. An administrator can rewrite it or take it back. */
function SentRow({
  row,
  games,
  canManage,
  onChanged,
}: {
  row: AdminBroadcast;
  games: AdminGame[] | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [draft, setDraft] = useState<AdminBroadcastMessage>(() => fromRow(row));
  const [busy, setBusy] = useState(false);

  const valid = draftProblem(draft) === null;

  function startEdit() {
    setDraft(fromRow(row));
    setMode("edit");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await updateAdminBroadcast(row.id, finished(draft));
      toast.success(t("Announcement updated."));
      setMode("view");
      onChanged();
    } catch (error) {
      toast.error(asApiError(error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await deleteAdminBroadcast(row.id);
      toast.success(t("Announcement deleted."));
      onChanged();
    } catch (error) {
      toast.error(asApiError(error).message);
      setMode("view");
    } finally {
      setBusy(false);
    }
  }

  if (mode === "edit") {
    return (
      <li className="px-4 py-3">
        <form className="space-y-3" onSubmit={(e) => void save(e)}>
          <AnnouncementFields value={draft} games={games} onChange={setDraft} />
          <p className="text-xs text-muted-foreground">
            {t("Changes show in every inbox. Nobody is notified again.")}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={!valid || busy}>
              {t("Save changes")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setMode("view")}
            >
              {t("Cancel")}
            </Button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="px-4 py-3">
      <div className="max-w-xl">
        <AnnouncementCard
          announcement={previewOf(fromRow(row), games)}
          createdAt={row.createdAt}
          unread={false}
        />
      </div>
      <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>{formatStamp(row.createdAt) ?? "—"}</span>
        {row.sentByUsername && <span>@{row.sentByUsername}</span>}
        <span>{t("{n} recipients", { n: row.recipients })}</span>
        <span>{t("{n} read", { n: row.readCount })}</span>
        {row.link && <span className="font-mono">{row.link}</span>}
      </p>
      {canManage && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {mode === "delete" ? (
            <>
              <p role="alert" className="w-full text-sm text-warning">
                {t("This removes it from every player's inbox and can't be undone.")}
              </p>
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 />
                {t("Yes, delete for everyone")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => setMode("view")}
              >
                {t("Cancel")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("Edit {title}", { title: row.title })}
                onClick={startEdit}
              >
                <Pencil />
                {t("Edit")}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                aria-label={t("Delete {title}", { title: row.title })}
                onClick={() => setMode("delete")}
              >
                <Trash2 />
                {t("Delete")}
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
}

const EMPTY: AdminBroadcastMessage = {
  title: "",
  body: "",
  link: "",
  style: "news",
  game: "",
  action: "",
};

function fromRow(row: AdminBroadcast): AdminBroadcastMessage {
  return {
    title: row.title,
    body: row.body,
    link: row.link ?? "",
    style: row.style ?? "news",
    game: row.game ?? "",
    action: row.action ?? "",
  };
}

/** A link with no button chosen gets Open, the same as the inbox draws it. */
function finished(draft: AdminBroadcastMessage): AdminBroadcastMessage {
  const action = draft.action === "" && draft.link.trim() !== "" ? "open" : draft.action;
  return { ...draft, action };
}

/**
 * Why the draft can't be sent yet: a sentence to show, "" for words still too short
 * (the button being off says enough), or null when it can go. The server agrees.
 */
function draftProblem(draft: AdminBroadcastMessage): string | null {
  if (draft.style === "new_game" && !draft.game) return t("A new-game announcement needs a game.");
  if (draft.action === "play" && !draft.game) return t("A Play button needs a game.");
  if (draft.action !== "" && draft.action !== "play" && draft.link.trim() === "") {
    return t("This button needs a link.");
  }
  if (draft.title.trim().length < 3 || draft.body.trim().length < 3) return "";
  return null;
}

/** The announcement as the inbox will read it. */
function previewOf(draft: AdminBroadcastMessage, games: AdminGame[] | null): Announcement {
  const ready = finished(draft);
  const link = internalLink(ready.link.trim());
  const game = ready.game || null;
  return {
    title: ready.title.trim() || t("Your headline"),
    body: ready.body.trim() || t("A short line under it."),
    link: /^\/[^/\\]/.test(link) ? link : null,
    style: ready.style,
    game,
    gameTitle: games?.find((g) => g.slug === game)?.title ?? null,
    action: ready.action || null,
  };
}

/** Published games, to picture in an announcement. */
function usePublishedGames(): AdminGame[] | null {
  const games = useAdminGames({ status: "published", limit: 100 });
  return games.status === "ready" ? games.data.items : null;
}

/**
 * Everything an administrator writes and picks for an announcement, with a preview
 * drawn by the inbox's own card, so it looks exactly like the notifications Unbored
 * sends by itself.
 */
function AnnouncementFields({
  value,
  games,
  onChange,
}: {
  value: AdminBroadcastMessage;
  games: AdminGame[] | null;
  onChange: (next: AdminBroadcastMessage) => void;
}) {
  const set = (patch: Partial<AdminBroadcastMessage>) => onChange({ ...value, ...patch });
  const problem = draftProblem(value);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block space-y-1.5">
          <span className="text-sm">{t("Notification type")}</span>
          <select
            value={value.style}
            onChange={(e) => set({ style: e.target.value as AnnouncementStyle })}
            className={FIELD}
          >
            {(Object.keys(ANNOUNCEMENT_STYLES) as AnnouncementStyle[]).map((key) => (
              <option key={key} value={key}>
                {t(ANNOUNCEMENT_STYLES[key].label)}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm">{t("Game (optional)")}</span>
          <select
            value={value.game}
            onChange={(e) => {
              const game = e.target.value;
              // A game with no button yet gets Play; losing the game loses Play.
              let action = value.action;
              if (game && action === "") action = "play";
              if (!game && action === "play") action = "";
              set({ game, action });
            }}
            className={FIELD}
          >
            <option value="">{t("No game")}</option>
            {value.game && !games?.some((g) => g.slug === value.game) && (
              <option value={value.game}>{value.game}</option>
            )}
            {(games ?? []).map((g) => (
              <option key={g.id} value={g.slug}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm">{t("Button")}</span>
          <select
            value={value.action}
            onChange={(e) => set({ action: e.target.value as AnnouncementAction | "" })}
            className={FIELD}
          >
            <option value="">{t("No button")}</option>
            {(Object.keys(ANNOUNCEMENT_ACTIONS) as AnnouncementAction[]).map((key) => (
              <option key={key} value={key} disabled={key === "play" && !value.game}>
                {t(ANNOUNCEMENT_ACTIONS[key].label)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block space-y-1.5">
        <span className="text-sm">{t("Title")}</span>
        <input
          value={value.title}
          maxLength={80}
          onChange={(e) => set({ title: e.target.value })}
          className={FIELD}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm">{t("Message")}</span>
        <textarea
          value={value.body}
          maxLength={300}
          rows={3}
          onChange={(e) => set({ body: e.target.value })}
          className={FIELD}
        />
      </label>
      <label className="block space-y-1.5">
        <span className="text-sm">{t("Link inside Unbored (optional)")}</span>
        <input
          value={value.link}
          maxLength={200}
          placeholder="/games/sudoku"
          onChange={(e) => set({ link: e.target.value })}
          className={FIELD}
        />
      </label>
      {problem && <p className="text-sm text-warning">{problem}</p>}
      <div className="space-y-1.5">
        <p className="text-sm">{t("Preview")}</p>
        <div className="pointer-events-none max-w-xl" aria-hidden>
          <AnnouncementCard announcement={previewOf(value, games)} createdAt={null} unread />
        </div>
      </div>
    </div>
  );
}
