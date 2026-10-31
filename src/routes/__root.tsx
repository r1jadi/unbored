import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Analytics } from "@vercel/analytics/react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { rootSeo, SITE_NAME } from "../lib/seo";
import { useDocumentTitle } from "@/lib/document-title";
import { AppShell } from "@/components/layout/AppShell";
import { SafeAreaDiagnostics } from "@/components/dev/SafeAreaDiagnostics";
import { Toaster } from "@/components/ui/sonner";
import { initializeSession, useAuth } from "@/lib/auth/session";
import { identifyUser, initAnalytics, resetAnalytics } from "@/lib/analytics";
import { LanguageProvider } from "@/lib/settings/language";
import { ThemeProvider } from "@/lib/settings/theme";

// Full-screen flows rendered without the main navigation.
const BARE = [
  "/admin",
  "/play",
  "/results",
  "/welcome",
  "/onboarding",
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
  "/account-created",
  "/auth/callback",
];

/**
 * Supabase falls back to the project's Site URL (the home page) when the
 * `emailRedirectTo` it was given is missing from the redirect allowlist. The
 * confirmation then lands on `/` carrying tokens nobody reads, and the visitor
 * is left signed out. Hand any such landing to `/auth/callback`, which is the
 * one screen that verifies them. Returns true when it navigated away.
 */
function forwardStrayAuthRedirect(): boolean {
  const { pathname, search, hash } = window.location;
  if (pathname.startsWith("/auth/callback")) return false;
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ""));
  const carriesAuth =
    fragment.has("access_token") ||
    (fragment.has("error") && fragment.has("error_description")) ||
    query.has("token_hash") ||
    // `?code` alone is too generic to claim on every page; Supabase only ever
    // sends it to the Site URL itself.
    (pathname === "/" && query.has("code"));
  if (!carriesAuth) return false;
  // Fragment errors become query parameters, which is where the callback reads them.
  if (fragment.has("error")) {
    for (const key of ["error", "error_description"]) {
      const value = fragment.get(key);
      if (value !== null) query.set(key, value);
    }
  }
  const nextSearch = query.toString();
  const nextHash = fragment.has("access_token") ? hash : "";
  window.location.replace(`/auth/callback${nextSearch ? `?${nextSearch}` : ""}${nextHash}`);
  return true;
}

// Paths a signed-in visitor may reach while registration is unfinished: the
// screen that completes it, the auth screens that can end or switch the
// session, and the legal documents the sign-up steps reference.
const UNFINISHED_SIGNUP_PATHS = [
  "/signup",
  "/login",
  "/welcome",
  "/onboarding",
  "/verify-email",
  "/forgot-password",
  "/reset-password",
  "/auth",
  "/terms",
  "/privacy",
];

function NotFoundComponent() {
  useDocumentTitle("Page not found");
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: ({ matches }) => {
    // Canonical URL, `robots` directive and site-level structured data come from
    // the matched pathname, so each route only states its own title/description
    // and private routes are excluded from indexing in exactly one place.
    const page = rootSeo(matches[matches.length - 1]?.pathname ?? "/");
    // A route's own title wins over this one. Only the root matched means no
    // route did, and the 404 page needs a title of its own rather than none.
    const notFound = matches.length <= 1 || matches.some((match) => match.status === "notFound");
    return {
      meta: [
        { charSet: "utf-8" },
        { title: notFound ? `Page not found — ${SITE_NAME}` : SITE_NAME },
        { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
        { name: "theme-color", content: "#16171b" },
        { name: "apple-mobile-web-app-capable", content: "yes" },
        { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
        { name: "apple-mobile-web-app-title", content: "Unbored" },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary_large_image" },
        ...page.meta,
      ],
      scripts: page.scripts,
      links: [
        {
          rel: "stylesheet",
          href: appCss,
        },
        { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
        { rel: "icon", type: "image/png", href: "/favicon.png" },
        { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=2" },
        { rel: "manifest", href: "/manifest.webmanifest" },
        ...page.links,
      ],
    };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
      </head>
      <body>
        <ThemeProvider>
          <LanguageProvider>{children}</LanguageProvider>
        </ThemeProvider>
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const path = useRouterState({ select: (st) => st.location.pathname });
  const navigate = useNavigate();
  const bare = BARE.some((p) => path.startsWith(p));
  const auth = useAuth();

  // Restore a persisted session after hydration, never during SSR: the server
  // render and the first client render must agree (both anonymous), and the
  // restored token is re-validated against the API before it is trusted.
  useEffect(() => {
    if (forwardStrayAuthRedirect()) return;
    initAnalytics();
    void initializeSession();
  }, []);

  // PostHog identity follows the session: the account id once signed in, a
  // fresh anonymous id after signing out ("restoring" changes nothing yet).
  const analyticsUserId = auth.status === "authenticated" ? auth.session.userId : undefined;
  const analyticsRole = auth.status === "authenticated" ? auth.session.role : undefined;
  useEffect(() => {
    if (auth.status === "restoring") return;
    if (analyticsUserId) identifyUser(analyticsUserId, { role: analyticsRole });
    else resetAnalytics();
  }, [auth.status, analyticsUserId, analyticsRole]);

  // A session without a finished registration (see `lib/users/registration`)
  // means the account is not fully created yet, so the app routes to the screen
  // that completes it. The server's answer drives this: `onboarded` is omitted
  // when it could not be read, which must never restart onboarding for anyone.
  const unfinishedSignup = auth.status === "authenticated" && auth.session.onboarded === false;
  const finishingSignup =
    unfinishedSignup && !UNFINISHED_SIGNUP_PATHS.some((p) => path.startsWith(p));

  useEffect(() => {
    if (finishingSignup) void navigate({ to: "/signup", replace: true });
  }, [finishingSignup, navigate]);

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required somewhere below: nested routes render through <Outlet />.
          Removing it breaks all child routes. */}
      {auth.status === "restoring" ? (
        // A stored session is being checked with the server: show neither the
        // signed-in nor the signed-out screens until that answer arrives.
        <div
          className="flex min-h-dvh items-center justify-center bg-background"
          role="status"
          aria-label="Restoring your session"
        >
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : finishingSignup ? (
        // Registration is incomplete: neither the app nor the signed-out
        // screens are the right thing to show for the one tick before the
        // redirect above lands.
        <div
          className="flex min-h-dvh items-center justify-center bg-background"
          role="status"
          aria-label="Finishing your sign-up"
        >
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : bare ? (
        <Outlet />
      ) : (
        <AppShell>
          <Outlet />
        </AppShell>
      )}
      {/* Dev-only safe-area/PWA probe (dead-code-eliminated in production). */}
      {import.meta.env.DEV ? <SafeAreaDiagnostics /> : null}
      {/* The page draws under the status bar (`viewport-fit=cover`), so the
          toasts sit below the safe area — otherwise they hide behind the notch. */}
      <Toaster
        position="top-center"
        theme="dark"
        offset={{ top: "calc(env(safe-area-inset-top) + 24px)" }}
        mobileOffset={{ top: "calc(env(safe-area-inset-top) + 12px)" }}
      />
      <Analytics />
    </QueryClientProvider>
  );
}
