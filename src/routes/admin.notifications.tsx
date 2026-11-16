import { createFileRoute } from "@tanstack/react-router";
import { Pencil, Send, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminListStates, AdminPage, SectionCard, StatCard } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  asApiError,
  deleteAdminBroadcast,
  formatStamp,
  sendAdminBroadcast,
  updateAdminBroadcast,
  type AdminBroadcast,
  useAdminBroadcasts,
  useAdminSession,
} from "@/lib/admin/api";

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
 */
function NotificationsAdmin() {
  const session = useAdminSession();
  const history = useAdminBroadcasts({ limit: 50, offset: 0 });
  const isAdmin = session.status === "ready" && session.data.isAdmin;

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length >= 3 && body.trim().length >= 3;

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const result = await sendAdminBroadcast({ title, body, link });
      toast.success(t("Sent to {n} players.", { n: result.recipients }));
      setTitle("");
      setBody("");
      setLink("");
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
              <label className="block space-y-1.5">
                <span className="text-sm">{t("Title")}</span>
                <input
                  value={title}
                  maxLength={80}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    setConfirming(false);
                  }}
                  className={FIELD}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm">{t("Message")}</span>
                <textarea
                  value={body}
                  maxLength={300}
                  rows={3}
                  onChange={(e) => {
                    setBody(e.target.value);
                    setConfirming(false);
                  }}
                  className={FIELD}
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-sm">{t("Link inside Unbored (optional)")}</span>
                <input
                  value={link}
                  maxLength={200}
                  placeholder="/games/sudoku"
                  onChange={(e) => {
                    setLink(e.target.value);
                    setConfirming(false);
                  }}
                  className={FIELD}
                />
              </label>
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
                <SentRow key={row.id} row={row} canManage={isAdmin} onChanged={history.retry} />
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

/** One sent announcement. An administrator can rewrite it or take it back out of every inbox. */
function SentRow({
  row,
  canManage,
  onChanged,
}: {
  row: AdminBroadcast;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "delete">("view");
  const [title, setTitle] = useState(row.title);
  const [body, setBody] = useState(row.body);
  const [link, setLink] = useState(row.link ?? "");
  const [busy, setBusy] = useState(false);

  const valid = title.trim().length >= 3 && body.trim().length >= 3;

  function startEdit() {
    setTitle(row.title);
    setBody(row.body);
    setLink(row.link ?? "");
    setMode("edit");
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      await updateAdminBroadcast(row.id, { title, body, link });
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
          <label className="block space-y-1.5">
            <span className="text-sm">{t("Title")}</span>
            <input
              value={title}
              maxLength={80}
              onChange={(e) => setTitle(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm">{t("Message")}</span>
            <textarea
              value={body}
              maxLength={300}
              rows={3}
              onChange={(e) => setBody(e.target.value)}
              className={FIELD}
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm">{t("Link inside Unbored (optional)")}</span>
            <input
              value={link}
              maxLength={200}
              placeholder="/games/sudoku"
              onChange={(e) => setLink(e.target.value)}
              className={FIELD}
            />
          </label>
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
      <p className="text-sm font-medium">{row.title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{row.body}</p>
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
