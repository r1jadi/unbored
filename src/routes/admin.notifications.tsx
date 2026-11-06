import { createFileRoute } from "@tanstack/react-router";
import { Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { AdminListStates, AdminPage, SectionCard, StatCard } from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  asApiError,
  formatStamp,
  sendAdminBroadcast,
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
 * Sends immediately; there are no drafts or schedules.
 */
export function NotificationsAdmin() {
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
                <li key={row.id} className="px-4 py-3">
                  <p className="text-sm font-medium">{row.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{row.body}</p>
                  <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span>{formatStamp(row.createdAt) ?? "—"}</span>
                    {row.sentByUsername && <span>@{row.sentByUsername}</span>}
                    <span>{t("{n} recipients", { n: row.recipients })}</span>
                    <span>{t("{n} read", { n: row.readCount })}</span>
                    {row.link && <span className="font-mono">{row.link}</span>}
                  </p>
                </li>
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
