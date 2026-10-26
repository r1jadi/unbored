import { Link, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  Bookmark,
  Clock,
  Compass,
  Home,
  Search,
  Settings,
  Shield,
  Trophy,
  User,
  Users,
} from "lucide-react";
import type { MouseEvent, ReactNode } from "react";
import { Logo } from "./Logo";
import { cn } from "@/lib/utils";
import { requestFeedRefresh } from "@/lib/feed-refresh";
import { useAuth } from "@/lib/auth/session";
import { useUnreadCount } from "@/lib/notifications/store";
import { useAdminVisibility } from "@/lib/admin/visibility";
import { useLanguage, type TranslationKey } from "@/lib/settings/language";

const mobile: Array<{ to: string; key: TranslationKey; icon: typeof Home }> = [
  { to: "/", key: "nav.home", icon: Home },
  { to: "/explore", key: "nav.explore", icon: Compass },
  { to: "/leaderboards", key: "nav.ranks", icon: Trophy },
  { to: "/notifications", key: "nav.inbox", icon: Bell },
  { to: "/profile", key: "nav.profile", icon: User },
];

const desktop: Array<{ to: string; key: TranslationKey; icon: typeof Home }> = [
  { to: "/", key: "nav.forYou", icon: Home },
  { to: "/following", key: "nav.following", icon: Users },
  { to: "/explore", key: "nav.explore", icon: Compass },
  { to: "/search", key: "nav.search", icon: Search },
  { to: "/leaderboards", key: "nav.leaderboards", icon: Trophy },
  { to: "/notifications", key: "nav.notifications", icon: Bell },
  { to: "/saved", key: "nav.saved", icon: Bookmark },
  { to: "/recent", key: "nav.recent", icon: Clock },
  { to: "/profile", key: "nav.profile", icon: User },
];

/**
 * Main navigation. Authentication comes from the single reactive session
 * store; the Admin link additionally requires the backend to confirm a staff
 * role (fail closed while loading). The notification badge renders only for a
 * successful (`ready`) unread-count read with a positive count: anonymous,
 * loading and failed reads render no badge, and a genuine zero renders the
 * unread-free state (also no badge) — never a fixture number.
 *
 * Visitors without a session see product auth entry points below Settings
 * ("Get started" opens the welcome chooser, "Log in" opens the login screen);
 * signed-in visitors see no sign-in CTA at all. Both links reuse the existing
 * routes, so no authentication logic lives here.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const auth = useAuth();
  const { t } = useLanguage();
  const unread = useUnreadCount();
  const showAdmin = useAdminVisibility();
  const isAnonymous = auth.status === "anonymous";
  // A badge only when the count is known-good and positive. Every other state
  // (anonymous, loading, genuine zero, failure) shows no badge; the failure
  // case is retryable via `unread.retry` without breaking navigation.
  const showBadge = unread.status === "ready" && unread.count > 0;
  const isActive = (to: string) => (to === "/" ? path === "/" : path.startsWith(to));
  const feed = path === "/" || path === "/following";
  // Home while already on the feed refreshes it instead of navigating nowhere.
  const onNavClick = (to: string) => (event: MouseEvent) => {
    if (to !== "/" || path !== "/") return;
    event.preventDefault();
    requestFeedRefresh();
  };

  return (
    <div className="min-h-dvh md:flex">
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 md:flex lg:w-64">
        <Link to="/" className="mb-6 px-3" aria-label="Unbored home">
          <Logo />
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5" aria-label="Main">
          {desktop.map(({ to, key, icon: Icon }) => (
            <Link
              key={to}
              to={to}
              onClick={onNavClick(to)}
              className={cn(
                "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                isActive(to) && "bg-sidebar-accent font-medium text-sidebar-foreground",
              )}
            >
              <Icon className="size-[18px]" strokeWidth={1.75} />
              <span className="flex-1">{t(key)}</span>
              {to === "/notifications" && showBadge && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground tabular">
                  {unread.count}
                </span>
              )}
            </Link>
          ))}
        </nav>
        <div className="flex flex-col gap-0.5 border-t border-sidebar-border pt-3">
          <Link
            to="/settings"
            className={cn(
              "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent",
              isActive("/settings") && "bg-sidebar-accent text-sidebar-foreground",
            )}
          >
            <Settings className="size-[18px]" strokeWidth={1.75} />
            {t("nav.settings")}
          </Link>
          {showAdmin && (
            <Link
              to="/admin"
              className={cn(
                "press flex h-10 items-center gap-3 rounded-lg px-3 text-sm text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                isActive("/admin") && "bg-sidebar-accent text-sidebar-foreground",
              )}
            >
              <Shield className="size-[18px]" strokeWidth={1.75} />
              {t("nav.admin")}
            </Link>
          )}
          {isAnonymous && (
            <div className="flex flex-col gap-2 px-3 pt-3">
              <Link
                to="/welcome"
                className="flex h-10 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Get started
              </Link>
              <Link
                to="/login"
                search={{ redirect: path }}
                className="flex h-10 items-center justify-center rounded-lg text-sm font-medium text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-foreground"
              >
                Log in
              </Link>
            </div>
          )}
        </div>
      </aside>

      <main className="min-w-0 flex-1">{children}</main>

      {/* Opaque fill for the home-indicator strip: the translucent bar above
          keeps blurring page content, while this layer guarantees the
          safe-area region is painted to the bottom edge in the navigation
          background instead of showing through as a dark strip. Zero-height
          (no-op) on devices without a bottom inset; hidden on desktop. */}
      <div
        aria-hidden
        className="fixed inset-x-0 bottom-0 z-30 h-[env(safe-area-inset-bottom)] bg-background md:hidden"
      />
      <nav
        aria-label="Main"
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 safe-bottom md:hidden",
          // Solid outside the feed: a translucent bar over a page of text lets the
          // text show through behind the labels and reads as a rendering bug.
          feed ? "bg-background/80 backdrop-blur-xl" : "border-t border-border bg-background",
        )}
      >
        <ul className="mx-auto grid h-16 max-w-md grid-cols-5">
          {mobile.map(({ to, key, icon: Icon }) => (
            <li key={to}>
              <Link
                to={to}
                onClick={onNavClick(to)}
                className={cn(
                  "press relative flex h-full flex-col items-center justify-center gap-1 text-[11px] text-muted-foreground",
                  isActive(to) && "text-foreground",
                )}
              >
                <Icon className="size-[22px]" strokeWidth={isActive(to) ? 2.1 : 1.75} />
                {t(key)}
                {to === "/notifications" && showBadge && (
                  <span
                    className="absolute top-2.5 left-1/2 ml-2 size-2 rounded-full bg-primary"
                    aria-label={`${unread.count} unread`}
                  />
                )}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
