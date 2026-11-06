import { createFileRoute } from "@tanstack/react-router";
import { Save, Server } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  MetaRow,
  SectionCard,
  StatusBadge,
  StatCard,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  asApiError,
  formatStamp,
  saveAdminPlatformSettings,
  useAdminPlatformSettings,
  useAdminSession,
  useAdminSystemServices,
} from "@/lib/admin/api";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [{ title: t("System — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: SystemSettings,
});

/**
 * What can be changed at runtime, and the platform's real shape.
 *
 * Each setting holds where it matters: the database refuses new comments or messages
 * while they are off, whatever a client shows, and every change is recorded with who
 * made it. Everything else a service does is decided by the environment variables it
 * validates at boot and by migrations, deployed and reviewed with the code.
 *
 * The service list — it is the routing table this deployment
 * actually runs — and it is reported without a health claim, because nothing here
 * collects uptime or latency. The one live fact on the page is the caller's own
 * role, read from the server that decides it: the allowlist for the role itself,
 * the database for the profile it names.
 */
function describeChange(
  before: { banner_text: string | null; comments_enabled: boolean; messages_enabled: boolean },
  after: { banner_text: string | null; comments_enabled: boolean; messages_enabled: boolean },
): string {
  const parts: string[] = [];
  if (before.banner_text !== after.banner_text) {
    parts.push(after.banner_text ? t("banner set") : t("banner cleared"));
  }
  if (before.comments_enabled !== after.comments_enabled) {
    parts.push(after.comments_enabled ? t("comments opened") : t("comments paused"));
  }
  if (before.messages_enabled !== after.messages_enabled) {
    parts.push(after.messages_enabled ? t("messages opened") : t("messages paused"));
  }
  return parts.join(", ");
}

function PlatformSettingsCard({ isAdmin }: { isAdmin: boolean }) {
  const settings = useAdminPlatformSettings();
  const [banner, setBanner] = useState("");
  const [comments, setComments] = useState(true);
  const [messages, setMessages] = useState(true);
  const [busy, setBusy] = useState(false);

  // Keyed on the answer, not the resource: that object is new on every render, and
  // copying from it each time would throw away an edit as soon as it was made.
  const saved = settings.status === "ready" ? settings.data : undefined;
  useEffect(() => {
    if (!saved) return;
    setBanner(saved.bannerText ?? "");
    setComments(saved.commentsEnabled);
    setMessages(saved.messagesEnabled);
  }, [saved]);

  if (settings.status === "error") {
    return (
      <SectionCard title={t("Platform settings")}>
        <AdminListStates
          state="error"
          onRetry={settings.retry}
          emptyTitle=""
          emptyBody={settings.error.message}
        />
      </SectionCard>
    );
  }
  if (settings.status === "loading") {
    return (
      <SectionCard title={t("Platform settings")}>
        <AdminListStates state="loading" emptyTitle="" rows={3} />
      </SectionCard>
    );
  }

  const dirty =
    banner.trim() !== (settings.data.bannerText ?? "") ||
    comments !== settings.data.commentsEnabled ||
    messages !== settings.data.messagesEnabled;

  async function save() {
    setBusy(true);
    try {
      await saveAdminPlatformSettings({
        bannerText: banner,
        commentsEnabled: comments,
        messagesEnabled: messages,
      });
      toast.success(t("Settings saved."));
      settings.retry();
    } catch (error) {
      toast.error(asApiError(error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title={t("Platform settings")}
      bodyClassName="p-4"
      action={
        isAdmin ? (
          <Button size="sm" disabled={!dirty || busy} onClick={() => void save()}>
            <Save />
            {t("Save changes")}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {t("Changing these requires an administrator")}
          </span>
        )
      }
    >
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">{t("Banner")}</span>
          <input
            value={banner}
            disabled={!isAdmin}
            maxLength={200}
            placeholder={t("Shown at the top of every page. Leave empty for none.")}
            onChange={(e) => setBanner(e.target.value)}
            className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">{t("Comments open")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("Off: nobody can post, and existing comments stay visible.")}
            </span>
          </span>
          <Switch checked={comments} disabled={!isAdmin} onCheckedChange={setComments} />
        </label>
        <label className="flex items-center justify-between gap-4">
          <span>
            <span className="block text-sm font-medium">{t("Messages open")}</span>
            <span className="block text-xs text-muted-foreground">
              {t("Off: nobody can send, and existing chats stay readable.")}
            </span>
          </span>
          <Switch checked={messages} disabled={!isAdmin} onCheckedChange={setMessages} />
        </label>
        {settings.data.log?.length > 0 && (
          <div>
            <p className="text-sm font-medium">{t("Recent changes")}</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {settings.data.log.map((entry) => (
                <li key={entry.id}>
                  {formatStamp(entry.createdAt) ?? "—"}
                  {entry.actorUsername ? ` · @${entry.actorUsername}` : ""}
                  {" · "}
                  {describeChange(entry.before, entry.after)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

export function SystemSettings() {
  const services = useAdminSystemServices();
  const session = useAdminSession();

  return (
    <AdminPage
      title={t("System")}
      subtitle={t("What this deployment runs, and how its configuration is actually applied.")}
    >
      <div className="space-y-4 md:space-y-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <StatCard
            label={t("Services routed")}
            value={services.status === "ready" ? String(services.data.items.length) : "—"}
            icon={Server}
          />
          <StatCard
            label={t("Health measured")}
            value={
              services.status === "ready" ? (services.data.measured ? t("yes") : t("no")) : "—"
            }
            tone="warning"
            delta={
              services.status === "ready" && !services.data.measured
                ? t("no metrics are collected in this deployment")
                : undefined
            }
          />
          <StatCard
            label={t("Your role")}
            value={session.status === "ready" ? session.data.role : "—"}
            tone={session.status === "ready" && session.data.isAdmin ? "success" : "muted"}
            delta={
              session.status === "ready"
                ? session.data.isAdmin
                  ? "administrator"
                  : "moderator"
                : undefined
            }
          />
        </div>

        <SectionCard
          title={t("Platform services")}
          bodyClassName="p-0"
          action={
            <span className="text-xs text-muted-foreground">
              {t("From the gateway's routing table")}
            </span>
          }
        >
          {services.status === "error" ? (
            <AdminListStates
              state="error"
              onRetry={services.retry}
              emptyTitle=""
              emptyBody={services.error.message}
            />
          ) : services.status === "loading" ? (
            <AdminListStates state="loading" emptyTitle="" rows={6} />
          ) : (
            <>
              <p className="border-b border-border px-4 py-2 text-xs text-muted-foreground">
                {services.data.note}
              </p>
              <ul className="divide-y divide-border">
                {services.data.items.map((service) => (
                  <li
                    key={service.name}
                    className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3"
                  >
                    <span className="min-w-40 flex-1 text-sm font-medium">{service.name}</span>
                    <span className="hidden min-w-0 flex-1 truncate text-xs text-muted-foreground lg:block">
                      {service.note}
                    </span>
                    <StatusBadge tone="muted">{service.status}</StatusBadge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </SectionCard>

        <SectionCard title={t("Your session as the server sees it")} bodyClassName="p-4">
          {session.status === "ready" ? (
            <dl className="divide-y divide-border">
              <MetaRow label={t("Account")}>@{session.data.username}</MetaRow>
              <MetaRow label={t("Display name")}>{session.data.displayName}</MetaRow>
              <MetaRow label={t("Role")}>
                <StatusBadge tone={session.data.isAdmin ? "primary" : "warning"}>
                  {session.data.role}
                </StatusBadge>
              </MetaRow>
              <MetaRow label={t("Account state")}>
                <StatusBadge tone={session.data.isSuspended ? "destructive" : "success"}>
                  {session.data.isSuspended ? t("suspended") : t("active")}
                </StatusBadge>
              </MetaRow>
              <MetaRow label={t("User id")}>
                <span className="font-mono text-xs">{session.data.userId}</span>
              </MetaRow>
            </dl>
          ) : (
            <AdminListStates
              state={session.status === "error" ? "error" : "loading"}
              onRetry={session.retry}
              emptyTitle=""
              rows={4}
            />
          )}
        </SectionCard>

        <PlatformSettingsCard isAdmin={session.status === "ready" && session.data.isAdmin} />
      </div>
    </AdminPage>
  );
}
