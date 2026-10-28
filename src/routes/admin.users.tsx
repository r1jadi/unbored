import { createFileRoute } from "@tanstack/react-router";
import { ShieldAlert, ShieldCheck, UserCog } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import {
  AdminListStates,
  AdminPage,
  AdminTable,
  FilterSelect,
  MobileRow,
  OffsetPager,
  PromptDialog,
  SearchField,
  SectionCard,
  StatusBadge,
  Toolbar,
  useDebounced,
  type Column,
} from "@/components/admin/ui";
import { UserAvatar } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  ADMIN_LIMIT,
  asApiError,
  formatAgo,
  formatWhen,
  setAccountSuspension,
  useAdminSession,
  useAdminUsers,
  type AdminRole,
  type AdminUser,
} from "@/lib/admin/api";
import { fmt } from "@/lib/format";

export const Route = createFileRoute("/admin/users")({
  head: () => ({
    meta: [{ title: "Users — Unbored admin" }, { name: "robots", content: "noindex" }],
  }),
  component: UsersAdmin,
});

const roleOptions = [
  { value: "", label: "All roles" },
  { value: "user", label: "Players" },
  { value: "moderator", label: "Moderators" },
  { value: "admin", label: "Administrators" },
];

const roleTone: Record<AdminRole, "muted" | "warning" | "primary"> = {
  user: "muted",
  moderator: "warning",
  admin: "primary",
};

/** A suspension or restoration, waiting on its reason. */
type Pending = { user: AdminUser; suspended: boolean } | null;

/**
 * The account directory.
 *
 * Suspension is the one action here, and it belongs to administrators: the route
 * is behind `AdminFunc` and the database function re-checks the role, so a
 * moderator's own session is refused even if this screen offered the button. The
 * button is therefore shown only to an administrator and explains itself when a
 * moderator is looking: a disabled control with a reason is honest, a hidden one
 * that reappears after a role change is not.
 *
 * Editing a role is not offered at all. Roles live in a table the API cannot
 * write, and they are changed with the documented procedure rather than from the
 * dashboard.
 */
export function UsersAdmin() {
  const [role, setRole] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const term = useDebounced(q.trim());

  const users = useAdminUsers({
    role: role ? (role as AdminRole) : undefined,
    q: term || undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });
  const session = useAdminSession();
  const isAdmin = session.status === "ready" && session.data.isAdmin;

  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = users.status === "ready" ? users.data.items : [];
  const hasMore = users.status === "ready" ? users.data.hasMore : false;

  const decide = (user: AdminUser, suspended: boolean, reason?: string) => {
    setBusy(user.id);
    setAccountSuspension(user.id, suspended, reason)
      .then((result) => {
        toast.success(
          result.suspended
            ? `@${user.username} is suspended.`
            : `@${user.username} is active again.`,
        );
        users.retry();
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setBusy(null));
  };

  const columns: Column<AdminUser>[] = [
    {
      key: "account",
      head: "Account",
      className: "min-w-56",
      cell: (u) => (
        <div className="flex min-w-0 items-center gap-3">
          <UserAvatar username={u.username} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{u.displayName}</span>
            <span className="block truncate text-xs text-muted-foreground">
              @{u.username}
              {u.email ? ` · ${u.email}` : ""}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: "role",
      head: "Role",
      cell: (u) => <StatusBadge tone={roleTone[u.role]}>{u.role}</StatusBadge>,
    },
    {
      key: "status",
      head: "Status",
      cell: (u) => (
        <StatusBadge tone={u.isSuspended ? "destructive" : "success"}>
          {u.isSuspended ? "suspended" : "active"}
        </StatusBadge>
      ),
    },
    {
      key: "joined",
      head: "Joined",
      cell: (u) => (
        <span className="text-xs text-muted-foreground">{formatWhen(u.createdAt) ?? "—"}</span>
      ),
    },
    {
      key: "active",
      head: "Last active",
      cell: (u) => (
        <span className="text-xs text-muted-foreground">
          {u.lastActiveAt ? (formatAgo(u.lastActiveAt) ?? "—") : "never"}
        </span>
      ),
    },
    {
      key: "plays",
      head: "Runs",
      className: "text-right",
      cell: (u) => <span className="font-mono text-sm tabular">{fmt(u.plays)}</span>,
    },
    {
      key: "best",
      head: "Best score",
      className: "text-right",
      cell: (u) => (
        <span className="font-mono text-sm tabular">
          {u.bestScore === null ? "—" : fmt(u.bestScore)}
        </span>
      ),
    },
    {
      key: "reports",
      head: "Reports against",
      className: "text-right",
      cell: (u) => (
        <span
          className={
            u.reportsAgainst > 0
              ? "font-mono text-sm text-warning tabular"
              : "font-mono text-sm text-muted-foreground tabular"
          }
        >
          {fmt(u.reportsAgainst)}
        </span>
      ),
    },
    {
      key: "actions",
      head: "",
      className: "w-40 text-right",
      cell: (u) => (
        <SuspendButton user={u} isAdmin={isAdmin} busy={busy === u.id} onDecide={setPending} />
      ),
    },
  ];

  return (
    <AdminPage
      title="Users"
      subtitle="Real accounts from the database. Sensitive fields are excluded server-side: no session tokens, no password material."
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          label="Search accounts"
          placeholder="Search username, name or email"
        />
        <FilterSelect
          label="Account role"
          value={role}
          onChange={(value) => {
            setRole(value);
            setPage(0);
          }}
          options={roleOptions}
        />
      </Toolbar>

      {!isAdmin && session.status === "ready" && (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-border bg-surface px-4 py-3 text-xs text-muted-foreground">
          <UserCog className="mt-0.5 size-4 shrink-0" />
          You are signed in as a moderator. Suspending or restoring an account requires an
          administrator; the server refuses it regardless of what this page shows.
        </p>
      )}

      {users.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={users.retry}
            emptyTitle=""
            emptyBody={users.error.message}
          />
        </SectionCard>
      ) : users.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={8} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={term || role ? "No account matches" : "No accounts"}
            emptyBody={
              term || role
                ? "Clear the search or choose another role."
                : "No account has been created yet."
            }
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(u) => u.id}
            mobileRow={(u) => (
              <MobileRow>
                <UserAvatar username={u.username} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{u.displayName}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    @{u.username} · {u.role}
                    {u.isSuspended ? " · suspended" : ""}
                  </span>
                </span>
                <SuspendButton
                  user={u}
                  isAdmin={isAdmin}
                  busy={busy === u.id}
                  onDecide={setPending}
                />
              </MobileRow>
            )}
          />
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="accounts"
          />
        </>
      )}

      <PromptDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.suspended ? "Suspend this account" : "Restore this account"}
        description={
          pending ? (
            <>
              <span className="block font-medium">
                {pending.user.displayName} (@{pending.user.username})
              </span>
              <span className="mt-1 block">
                {pending.suspended
                  ? "The account keeps its data and history. Whoever holds the account is refused everywhere until it is restored, and the reason is recorded against your name."
                  : "The account can sign in and play again. The reason is recorded against your name."}
              </span>
            </>
          ) : undefined
        }
        label={pending?.suspended ? "Reason for suspension" : "Reason for restoring"}
        confirmLabel={pending?.suspended ? "Suspend" : "Restore"}
        destructive={pending?.suspended}
        onConfirm={(reason) => {
          if (pending) decide(pending.user, pending.suspended, reason);
          setPending(null);
        }}
      />
    </AdminPage>
  );
}

function SuspendButton({
  user,
  isAdmin,
  busy,
  onDecide,
}: {
  user: AdminUser;
  isAdmin: boolean;
  busy: boolean;
  onDecide: (pending: Pending) => void;
}) {
  if (!isAdmin) {
    return (
      <Button
        variant="ghost"
        size="sm"
        disabled
        title="Suspending an account requires an administrator."
        className="text-muted-foreground"
      >
        <ShieldAlert />
        Admin only
      </Button>
    );
  }

  return (
    <Button
      variant={user.isSuspended ? "secondary" : "ghost"}
      size="sm"
      disabled={busy}
      onClick={() => onDecide({ user, suspended: !user.isSuspended })}
    >
      {user.isSuspended ? <ShieldCheck /> : <ShieldAlert />}
      {user.isSuspended ? "Restore" : "Suspend"}
    </Button>
  );
}
