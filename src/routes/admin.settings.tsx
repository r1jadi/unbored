import { createFileRoute } from "@tanstack/react-router";
import { Server, SlidersHorizontal } from "lucide-react";
import {
  AdminListStates,
  AdminPage,
  MetaRow,
  SectionCard,
  StatusBadge,
  StatCard,
  UnavailablePanel,
} from "@/components/admin/ui";
import { useAdminSession, useAdminSystemServices } from "@/lib/admin/api";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin/settings")({
  head: () => ({
    meta: [{ title: t("System — Unbored admin") }, { name: "robots", content: "noindex" }],
  }),
  component: SystemSettings,
});

/**
 * The platform's real shape, and an honest account of what cannot be configured.
 *
 * The prototype showed four tabs of switches and selects with a Save button that
 * toasted "Settings saved" into a void. Nothing about that was real: there is no
 * settings row, no maintenance flag and no feature-flag table, so a switch could
 * only have changed the browser it was flipped in.
 *
 * What is real is the service list — it is the routing table this deployment
 * actually runs — and it is reported without a health claim, because nothing here
 * collects uptime or latency. The one live fact on the page is the caller's own
 * role, read from the server that decides it: the allowlist for the role itself,
 * the database for the profile it names.
 */
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

        <SectionCard bodyClassName="p-0">
          <UnavailablePanel
            icon={SlidersHorizontal}
            title={t("Platform settings are not editable here")}
            body={t(
              "This deployment holds no runtime settings: there is no settings row, no maintenance flag, no feature-flag table and no notification policy. A switch on this page could only change the browser it was flipped in, so the switches are gone.",
            )}
            points={[
              "What each service does is decided by the environment variables it validates at boot, and by the database migrations — both are deployed with the code, not edited from a dashboard.",
              "Changing those means a configuration change or a migration, reviewed like any other change, which is also why there is no Save button.",
              "If runtime-editable settings are wanted, they need a table with an audit trail and a write path that authorizes per key — a feature in its own right, not a form.",
            ]}
          />
        </SectionCard>
      </div>
    </AdminPage>
  );
}
