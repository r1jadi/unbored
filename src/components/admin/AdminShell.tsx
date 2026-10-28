import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  ArrowLeft,
  BarChart3,
  ClipboardCheck,
  Flag,
  Gamepad2,
  LayoutDashboard,
  Lock,
  MessageSquare,
  Send,
  SlidersHorizontal,
  Star,
  Tags,
  Trophy,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import { ErrorState, UserAvatar } from "@/components/common";
import { LogoMark } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAdminOverview, useAdminSession } from "@/lib/admin/api";
import { cn } from "@/lib/utils";

type AdminRoute =
  | "/admin"
  | "/admin/reports"
  | "/admin/review"
  | "/admin/comments"
  | "/admin/games"
  | "/admin/categories"
  | "/admin/featured"
  | "/admin/leaderboards"
  | "/admin/users"
  | "/admin/analytics"
  | "/admin/notifications"
  | "/admin/settings";

type AdminNavItem = { to: AdminRoute; label: string; icon: typeof LayoutDashboard; exact: boolean };

const nav: { label: string; items: AdminNavItem[] }[] = [
  {
    label: "Overview",
    items: [{ to: "/admin", label: "Overview", icon: LayoutDashboard, exact: true }],
  },
  {
    label: "Moderation",
    items: [
      { to: "/admin/reports", label: "Reports", icon: Flag, exact: false },
      { to: "/admin/review", label: "Review queue", icon: ClipboardCheck, exact: false },
      { to: "/admin/comments", label: "Comments", icon: MessageSquare, exact: false },
    ],
  },
  {
    label: "Content",
    items: [
      { to: "/admin/games", label: "Games", icon: Gamepad2, exact: false },
      { to: "/admin/categories", label: "Categories", icon: Tags, exact: false },
      { to: "/admin/featured", label: "Featured", icon: Star, exact: false },
      { to: "/admin/leaderboards", label: "Leaderboards", icon: Trophy, exact: false },
    ],
  },
  {
    label: "Community",
    items: [{ to: "/admin/users", label: "Users", icon: Users, exact: false }],
  },
  {
    label: "System",
    items: [
      { to: "/admin/analytics", label: "Analytics", icon: BarChart3, exact: false },
      { to: "/admin/notifications", label: "Notifications", icon: Send, exact: false },
      { to: "/admin/settings", label: "Settings", icon: SlidersHorizontal, exact: false },
    ],
  },
];

const flat: AdminNavItem[] = nav.flatMap((g) => g.items);

/**
 * The badge a queue item carries.
 *
 * The count comes from the API's own aggregate, and while it is loading or
 * failed there is no badge at all — a `0` here would read as "nothing to do",
 * which is a claim the dashboard has not earned.
 */
function QueueBadge({ count, tone }: { count: number | undefined; tone: "primary" | "muted" }) {
  if (count === undefined) return null;
  return (
    <span
      className={cn(
        "rounded-full px-1.5 text-[11px] tabular",
        tone === "primary"
          ? "bg-primary font-semibold text-primary-foreground"
          : "bg-surface-2 font-medium text-muted-foreground",
      )}
    >
      {count}
    </span>
  );
}

export function AdminShell({ children }: { children?: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const session = useAdminSession();

  // The gate. The API enforces the allowlist on every route — this decides what
  // to render so that a person who is not allowlisted sees why rather than a
  // broken dashboard.
  if (session.status === "loading") {
    return (
      <div className="mx-auto w-full max-w-7xl px-4 pt-8 md:px-8">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="mt-4 h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (session.status === "error") {
    const error = session.error;
    if (error.isUnauthorized) {
      return (
        <AdminGate
          title="Sign in to open the dashboard"
          body="The admin API answers only requests that carry a verified session."
        >
          <Button asChild>
            <Link to="/login" search={{ redirect: "/admin" }}>
              Sign in
            </Link>
          </Button>
        </AdminGate>
      );
    }
    return <ErrorState onRetry={session.retry} body={error.message} />;
  }

  if (!session.data.isStaff) {
    return (
      <AdminGate
        title="This area requires an administrator account"
        body="Your account is not on the administrator allowlist, so the API has no admin data to show you."
      >
        <Button asChild variant="secondary">
          <Link to="/">Back to Unbored</Link>
        </Button>
      </AdminGate>
    );
  }

  return <AdminDashboard path={path} session={session.data} children={children} />;
}

/** The two states in which there is no dashboard to render. */
function AdminGate({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center px-6 text-center">
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-surface-2">
        <Lock className="size-5 text-muted-foreground" />
      </div>
      <p className="font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}

function AdminDashboard({
  path,
  session,
  children,
}: {
  path: string;
  session: { username: string; displayName: string; role: string; isAdmin: boolean };
  children?: ReactNode;
}) {
  // One read for the two queue badges. It is the same aggregate the overview
  // screen shows, so the badge and the page behind it cannot disagree.
  const overview = useAdminOverview();
  const counts = overview.status === "ready" ? overview.data : undefined;

  const isActive = (to: string, exact?: boolean) =>
    exact ? path === to || path === `${to}/` : path.startsWith(to);

  const roleLabel = session.isAdmin ? "Administrator" : "Moderator";

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex lg:w-64">
        <Link to="/" className="mb-1 flex items-center gap-2 px-3" aria-label="Back to Unbored">
          <LogoMark className="size-6" />
          <span className="text-base font-semibold">Unbored</span>
        </Link>
        <p className="mb-4 px-3 text-xs text-muted-foreground">Admin dashboard</p>
        <nav className="no-scrollbar flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Admin">
          {nav.map((group) => (
            <div key={group.label} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
                {group.label}
              </p>
              {group.items.map(({ to, label, icon: Icon, exact }) => (
                <Link
                  key={to}
                  to={to}
                  className={cn(
                    "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                    isActive(to, exact) && "bg-sidebar-accent font-medium text-sidebar-foreground",
                  )}
                >
                  <Icon className="size-[18px]" strokeWidth={1.75} />
                  <span className="flex-1">{label}</span>
                  {to === "/admin/reports" && (
                    <QueueBadge count={counts?.openReports} tone="primary" />
                  )}
                  {to === "/admin/review" && (
                    <QueueBadge count={counts?.pendingReview} tone="muted" />
                  )}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="mt-3 border-t border-sidebar-border pt-3">
          <Link
            to="/"
            className="press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={1.75} />
            Back to Unbored
          </Link>
          <div className="mt-1 flex items-center gap-2.5 px-3 pt-2">
            <UserAvatar username={session.username} size="sm" />
            <div className="min-w-0 text-xs">
              <p className="truncate font-medium">@{session.username}</p>
              <p className="truncate text-muted-foreground">{roleLabel}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-40 glass border-x-0 border-t-0 md:hidden">
          <div className="flex items-center gap-2 px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-2">
            <Link to="/" aria-label="Back to Unbored" className="press flex items-center gap-2">
              <LogoMark className="size-6" />
              <span className="text-sm font-semibold">Unbored admin</span>
            </Link>
            <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted-foreground">
              {roleLabel}
            </span>
          </div>
          <nav aria-label="Admin" className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3">
            {flat.map(({ to, label, exact }) => (
              <Link
                key={to}
                to={to}
                className={cn(
                  "press shrink-0 rounded-full px-3 py-1.5 text-sm",
                  isActive(to, exact)
                    ? "bg-foreground font-medium text-background"
                    : "bg-surface text-muted-foreground",
                )}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        {children ?? <Outlet />}
      </div>
    </div>
  );
}

/** Content column for admin screens — full width on desktop, padded on mobile. */
export function AdminContainer({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("mx-auto w-full max-w-7xl px-4 pt-5 pb-16 md:px-8 md:pt-8 md:pb-14", className)}
    >
      {children}
    </div>
  );
}
