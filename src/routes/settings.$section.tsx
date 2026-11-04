import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar, EmptyState, ErrorState, Page, PageHeader, UserAvatar } from "@/components/common";
import { LegalBody, privacy, terms } from "@/components/legal";
import { allSettings } from "@/components/settings/config";
import { FeedbackForm } from "@/components/settings/FeedbackForm";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { PushToggle } from "@/components/settings/PushToggle";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import { changePassword, fetchLinkedProviders, signOut, useAuth } from "@/lib/auth/session";
import { offeredLanguages, useLanguage, t, msg } from "@/lib/settings/language";
import { useTheme, type Appearance } from "@/lib/settings/theme";
import { useAccessibility } from "@/lib/settings/accessibility";
import { useSoundEnabled } from "@/lib/sound";
import {
  defaultPreferences,
  loadPreferences,
  savePreferences,
  type UserPreferences,
} from "@/lib/settings/preferences";
import { listBlocked, unblockUser } from "@/lib/settings/blocked";
import { avatarUrl, clearProfile, useProfile } from "@/lib/users/profile";
import { cn } from "@/lib/utils";
import { resetConsent, setConsent, useConsent } from "@/lib/consent";

export const Route = createFileRoute("/settings/$section")({
  // `?category=bug` opens the feedback form on "Something broke" (Help → Open an issue).
  validateSearch: (search: Record<string, unknown>): { category?: "bug" } =>
    search["category"] === "bug" ? { category: "bug" } : {},
  head: ({ params }) => {
    const item = allSettings.find((s) => s.slug === params.section);
    const name = item ? t(item.title) : undefined;
    // An unknown section has no name of its own; without the guard the title
    // reads "Settings settings — Unbored". Pages that are not settings as such
    // (Help, the legal pages, About) carry their own `pageTitle`.
    const pageTitle = item
      ? item.pageTitle
        ? t(item.pageTitle)
        : t("{title} settings", { title: name ?? "" })
      : t("Settings");
    const description = name
      ? t("Manage {name} on Unbored.", { name: name.toLowerCase() })
      : t("Manage your Unbored settings.");
    return {
      meta: [
        { title: t("{pageTitle} — Unbored", { pageTitle }) },
        { name: "description", content: description },
        { property: "og:title", content: `${name ?? t("Settings")} — Unbored` },
        { property: "og:description", content: description },
      ],
    };
  },
  component: Section,
});

function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      {title && (
        <h2 className="px-4 pb-2 text-xs font-medium text-muted-foreground md:px-0">{title}</h2>
      )}
      <div className="mx-4 divide-y divide-border overflow-hidden rounded-xl bg-surface md:mx-0">
        {children}
      </div>
    </section>
  );
}

function Toggle({
  id,
  label,
  desc,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  desc?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <Label htmlFor={id} className="flex-1 font-normal">
        <span className="block text-sm">{label}</span>
        {desc && <span className="text-xs text-muted-foreground">{desc}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

/**
 * This browser's cookie choice (`lib/consent.ts`): analytics on or off, or
 * the cookie jar back to choose again. It is the browser's, not the account's,
 * so guests have it too.
 */
function CookieChoices() {
  const consent = useConsent();
  return (
    <Group title={t("Cookies")}>
      <Toggle
        id="cookies-analytics"
        label={t("Analytics cookies")}
        desc={t("Count visits and how games are played, to make Unbored better")}
        checked={consent?.analytics === true}
        onChange={(v) => setConsent(v)}
      />
      <Row label={t("Essential storage")} value={t("Always on")} />
      <Row
        label={t("Bring back the cookie jar")}
        action={
          <Button variant="secondary" size="sm" onClick={resetConsent}>
            {t("Show")}
          </Button>
        }
      />
    </Group>
  );
}

function Row({ label, value, action }: { label: string; value?: string; action?: ReactNode }) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      <span className="flex-1 text-sm">{label}</span>
      {value && <span className="text-sm text-muted-foreground">{value}</span>}
      {action}
    </div>
  );
}

function usePrefs() {
  const [prefs, setPrefs] = useState<UserPreferences>(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let cancelled = false;
    loadPreferences()
      .then((value) => {
        if (!cancelled) setPrefs(value);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function update(next: UserPreferences) {
    setPrefs(next);
    setSaving(true);
    setError(undefined);
    try {
      await savePreferences(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  return { prefs, loading, saving, error, update };
}

function RequireSignIn({ body }: { body: string }) {
  // Return the visitor to the setting they were trying to manage, not to Home.
  const path = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div className="px-4 md:px-0">
      <EmptyState
        title={t("Sign in to manage settings")}
        body={body}
        action={
          <Button asChild>
            <Link to="/login" search={{ redirect: path }}>
              {t("Log in")}
            </Link>
          </Button>
        }
      />
    </div>
  );
}

const faq = [
  [
    msg("How do I create an account?"),
    msg(
      "Use Sign up with an email and password, open the confirmation link we email you, then log in. Google sign-in is available from the same screens once the provider is enabled.",
    ),
  ],
  [
    msg("How are scores verified?"),
    msg(
      "Play sessions are created by the server and scores are recorded against them. Only published games appear on leaderboards.",
    ),
  ],
  [
    msg("How do I follow someone?"),
    msg(
      "Open their profile or find them in Search and use Follow. Player-made games are coming later, and when they do, games from people you follow will show up in your Following feed.",
    ),
  ],
  [
    msg("How do I report a player?"),
    msg("Open their profile, tap the menu, and choose Report. Reports are reviewed by moderators."),
  ],
  [
    msg("How do I delete my account?"),
    msg(
      "Settings → Delete account explains the current process. Deletion removes your profile and social relationships; scores on public leaderboards are retained without attribution where required.",
    ),
  ],
];

function Body({ section, category }: { section: string; category?: "bug" }) {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const { prefs, loading, error, update } = usePrefs();
  const { language, setLanguage } = useLanguage();
  const { choice, setChoice } = useTheme();
  const { prefs: a11y, setPrefs: setA11y } = useAccessibility();
  const [soundOn, setSoundOn] = useSoundEnabled();

  // The language page is only a choice when there is more than one language to
  // pick; until then an old link to it lands on "Setting not found".
  const page = section === "language" && offeredLanguages.length < 2 ? "" : section;

  switch (page) {
    case "account":
      return <AccountSection signedIn={signedIn} />;
    case "profile":
      // The real editor: reads and writes the account's own profile row.
      return <ProfileForm />;
    case "privacy":
      if (!signedIn) {
        return (
          <>
            <CookieChoices />
            <div className="mt-6">
              <RequireSignIn body={t("Privacy choices belong to your account.")} />
            </div>
          </>
        );
      }
      if (loading) return <p className="px-4 text-sm text-muted-foreground">{t("Loading…")}</p>;
      return (
        <>
          <CookieChoices />
          <Group title={t("Visibility")}>
            <Toggle
              id="p1"
              label={t("Private profile")}
              desc={t("Visitors only see your name and picture")}
              checked={prefs.privateAccount}
              onChange={(v) => void update({ ...prefs, privateAccount: v })}
            />
            <Toggle
              id="p7"
              label={t("Show my scores on my profile")}
              desc={t("Visitors see your best scores, even if your profile is private")}
              checked={prefs.showProfileScores}
              onChange={(v) => void update({ ...prefs, showProfileScores: v })}
            />
            <Toggle
              id="p2"
              label={t("Show on leaderboards")}
              desc={t("Turn off to leave every game's board. Your scores are kept")}
              checked={prefs.showOnLeaderboards}
              onChange={(v) => void update({ ...prefs, showOnLeaderboards: v })}
            />
            <Toggle
              id="p3"
              label={t("Show recently played")}
              desc={t("Visitors see your recent games, unless your profile is private")}
              checked={prefs.showRecentlyPlayed}
              onChange={(v) => void update({ ...prefs, showRecentlyPlayed: v })}
            />
          </Group>
          <Group title={t("Interactions")}>
            <Toggle
              id="p4"
              label={t("Allow comments on my scores")}
              checked={prefs.allowComments}
              onChange={(v) => void update({ ...prefs, allowComments: v })}
            />
            <Toggle
              id="p5"
              label={t("Allow mentions")}
              checked={prefs.allowMentions}
              onChange={(v) => void update({ ...prefs, allowMentions: v })}
            />
            <Toggle
              id="p6"
              label={t("Personalised recommendations")}
              checked={prefs.personalisedRecommendations}
              onChange={(v) => void update({ ...prefs, personalisedRecommendations: v })}
            />
          </Group>
          {error && (
            <p className="mt-3 px-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </>
      );
    case "notifications":
      if (!signedIn)
        return <RequireSignIn body={t("Notification preferences belong to your account.")} />;
      if (loading) return <p className="px-4 text-sm text-muted-foreground">{t("Loading…")}</p>;
      return (
        <>
          <Group title={t("Notify me about")}>
            <Toggle
              id="n5"
              label={t("A new game comes out")}
              desc={t("Get in first, while the leaderboard is wide open")}
              checked={prefs.notifyGameReleases}
              onChange={(v) => void update({ ...prefs, notifyGameReleases: v })}
            />
            <Toggle
              id="n1"
              label={t("A friend beats your score")}
              desc={t("A friend is someone you follow who follows you back")}
              checked={prefs.notifyBeats}
              onChange={(v) => void update({ ...prefs, notifyBeats: v })}
            />
            <Toggle
              id="n2"
              label={t("New followers")}
              checked={prefs.notifyFollowers}
              onChange={(v) => void update({ ...prefs, notifyFollowers: v })}
            />
            <Toggle
              id="n3"
              label={t("Comments and replies")}
              checked={prefs.notifyComments}
              onChange={(v) => void update({ ...prefs, notifyComments: v })}
            />
          </Group>
          <Group title={t("Email")}>
            <Toggle
              id="n4"
              label={t("New games")}
              desc={t(
                "One email after every five new games, with how to play. Turn it off any time.",
              )}
              checked={prefs.notifyNewGames}
              onChange={(v) => void update({ ...prefs, notifyNewGames: v })}
            />
          </Group>
          <Group title={t("Push")}>
            <PushToggle />
          </Group>
          {error && (
            <p className="mt-3 px-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </>
      );
    case "security":
      return <SecuritySection signedIn={signedIn} />;
    case "language":
      return (
        <div className="grid gap-2 px-4 md:px-0" role="radiogroup" aria-label={t("Language")}>
          {offeredLanguages.map((option) => (
            <button
              key={option.code}
              role="radio"
              aria-checked={language === option.code}
              onClick={() => setLanguage(option.code)}
              className={cn(
                "press flex items-center gap-3 rounded-xl border p-4 text-left",
                language === option.code
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface",
              )}
            >
              <span className="flex-1">
                <span className="block text-sm font-medium">{option.native}</span>
                <span className="text-xs text-muted-foreground">{t(option.label)}</span>
              </span>
              {language === option.code && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
      );
    case "appearance": {
      const options: Array<{ value: Appearance; desc: string }> = [
        { value: "dark", desc: t("Default. Best for playing at night.") },
        { value: "light", desc: t("Light surfaces for bright rooms.") },
        { value: "system", desc: t("Follow your device setting") },
      ];
      const labels: Record<Appearance, string> = {
        dark: t("Dark"),
        light: t("Light"),
        system: t("System"),
      };
      return (
        <div className="grid gap-2 px-4 md:px-0" role="radiogroup" aria-label={t("Appearance")}>
          {options.map((option) => (
            <button
              key={option.value}
              role="radio"
              aria-checked={choice === option.value}
              onClick={() => setChoice(option.value)}
              className={cn(
                "press flex items-center gap-3 rounded-xl border p-4 text-left",
                choice === option.value
                  ? "border-primary bg-primary/5"
                  : "border-border bg-surface",
              )}
            >
              <span className="flex-1">
                <span className="block text-sm font-medium">{labels[option.value]}</span>
                <span className="text-xs text-muted-foreground">{option.desc}</span>
              </span>
              {choice === option.value && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
      );
    }
    case "accessibility":
      return (
        <>
          <Group title={t("Motion")}>
            <Toggle
              id="a1"
              label={t("Reduce motion")}
              desc={t("Minimise animations across the app")}
              checked={a11y.reduceMotion}
              onChange={(v) => setA11y({ ...a11y, reduceMotion: v })}
            />
          </Group>
          <Group title={t("Sound")}>
            <Toggle
              id="a5"
              label={t("Game sound effects")}
              desc={t("Play sounds for moves, clears and the end of a run")}
              checked={soundOn}
              onChange={setSoundOn}
            />
          </Group>
          <Group title={t("Display")}>
            <Toggle
              id="a3"
              label={t("Increase contrast")}
              checked={a11y.increaseContrast}
              onChange={(v) => setA11y({ ...a11y, increaseContrast: v })}
            />
            <Toggle
              id="a4"
              label={t("Larger text")}
              checked={a11y.largerText}
              onChange={(v) => setA11y({ ...a11y, largerText: v })}
            />
          </Group>
          <p className="mt-3 px-4 text-xs text-muted-foreground md:px-0">
            {t("Changes apply immediately and are remembered on this device.")}
          </p>
        </>
      );
    case "connected":
      return <ConnectedSection signedIn={signedIn} />;
    case "blocked":
      return <BlockedSection signedIn={signedIn} />;
    case "feedback":
      return <FeedbackForm initialCategory={category} />;
    case "help":
      return (
        <>
          <Group title={t("Frequently asked")}>
            {faq.map(([q, a]) => (
              <details key={q} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                  {t(q)}
                  <ChevronDown className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{t(a)}</p>
              </details>
            ))}
          </Group>
          <div className="mt-4 px-4 md:px-0">
            <p className="text-sm text-muted-foreground">
              {t("Still stuck, or found a bug? Send us an issue report and we'll take a look.")}
            </p>
            <Button asChild size="lg" className="mt-3 w-full md:w-auto">
              <Link
                to="/settings/$section"
                params={{ section: "feedback" }}
                search={{ category: "bug" }}
              >
                {t("Open an issue")}
              </Link>
            </Button>
          </div>
        </>
      );
    case "terms":
      return (
        <div className="px-4 md:px-0">
          <LegalBody sections={terms} />
        </div>
      );
    case "privacy-policy":
      return (
        <div className="px-4 md:px-0">
          <LegalBody sections={privacy} />
        </div>
      );
    case "about":
      return (
        <Group>
          <Row label={t("Version")} value={import.meta.env?.["VITE_APP_VERSION"] || "0.1.0"} />
          <Row label={t("Website")} value="unbored.lol" />
        </Group>
      );
    default:
      return (
        <EmptyState
          title={t("Setting not found")}
          action={
            <Button asChild variant="secondary">
              <Link to="/settings">{t("Back to settings")}</Link>
            </Button>
          }
        />
      );
  }
}

function AccountSection({ signedIn }: { signedIn: boolean }) {
  const profile = useProfile();
  const auth = useAuth();
  const email = auth.status === "authenticated" ? (auth.session.email ?? "") : "";

  if (!signedIn) return <RequireSignIn body={t("Your account details belong to your account.")} />;

  if (profile.status === "ready") {
    return (
      <>
        <Group title={t("Login")}>
          <Row label={t("Email")} value={maskEmail(email || "unknown")} />
          <Row
            label={t("Password")}
            value={t("Set at signup")}
            action={
              <Button asChild size="sm" variant="ghost">
                <Link to="/reset-password">{t("Change")}</Link>
              </Button>
            }
          />
        </Group>
        <Group title={t("Profile")}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Avatar name={profile.profile.username} src={avatarUrl(profile.profile)} size="sm" />
            <span className="flex-1 text-sm">
              {profile.profile.displayName} · @{profile.profile.username}
            </span>
            <Button asChild size="sm" variant="ghost">
              <Link to="/settings/$section" params={{ section: "profile" }}>
                {t("Edit")}
              </Link>
            </Button>
          </div>
        </Group>
      </>
    );
  }
  if (profile.status === "error") {
    return (
      <div className="px-4 md:px-0">
        <ErrorState
          title={t("Couldn't load your account")}
          body={profile.error.message}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
  return <p className="px-4 text-sm text-muted-foreground">{t("Loading your account…")}</p>;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return email;
  const head = (local ?? "").slice(0, 1);
  return `${head}•••@${domain}`;
}

export function SecuritySection({ signedIn }: { signedIn: boolean }) {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  if (!signedIn) return <RequireSignIn body={t("Security controls belong to your account.")} />;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError(t("Use at least 8 characters for your password."));
      return;
    }
    if (password !== confirm) {
      setError(t("Passwords don't match."));
      return;
    }
    setError(undefined);
    setStatus(undefined);
    setBusy(true);
    try {
      await changePassword(password);
      setStatus(t("Password updated."));
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Couldn't update the password."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group title={t("Password")}>
        <form className="space-y-3 px-4 py-3" onSubmit={submit}>
          <label className="block space-y-1.5" htmlFor="new-password">
            <span className="text-sm">{t("New password")}</span>
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full rounded-lg bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {/* The rule the server enforces, stated where it is needed: without it
              a short password left the button disabled with no reason. It sits
              outside the label so it does not become part of the field's name. */}
          <p className="text-xs text-muted-foreground">{t("At least 8 characters.")}</p>
          <label className="block space-y-1.5" htmlFor="confirm-password">
            <span className="text-sm">{t("Confirm password")}</span>
            <input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="h-11 w-full rounded-lg bg-surface-2 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {status && (
            <p className="text-sm text-success" role="status">
              {status}
            </p>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy}>
            {t("Update password")}
          </Button>
        </form>
      </Group>
      <Group title={t("Sessions")}>
        <Row
          label={t("This device")}
          value={t("Current session")}
          action={
            <Button
              size="sm"
              variant="ghost"
              onClick={async () => {
                // The session is cleared locally before the revoke is sent, so a
                // failed call cannot leave the visitor inside a signed-in shell.
                try {
                  await signOut();
                } catch {
                  // The local session is already gone; the token expires on its own.
                }
                clearProfile();
                void navigate({ to: "/welcome" });
              }}
            >
              {t("Log out")}
            </Button>
          }
        />
        <Row
          label={t("Other sessions")}
          value={t("Use log out on each device")}
          action={
            <span className="text-xs text-muted-foreground">
              {t("Per-device session list is not implemented")}
            </span>
          }
        />
      </Group>
      <p className="mt-3 px-4 text-xs text-muted-foreground md:px-0">
        {t(
          "Two-step verification is not implemented — it is not offered here rather than shown as a toggle that does nothing.",
        )}
      </p>
    </>
  );
}

function ConnectedSection({ signedIn }: { signedIn: boolean }) {
  const [providers, setProviders] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetchLinkedProviders()
      .then((entries) => {
        if (!cancelled) setProviders(entries.map((entry) => entry.provider));
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn) return <RequireSignIn body={t("Connected accounts belong to your account.")} />;
  if (!loaded) return <p className="px-4 text-sm text-muted-foreground">{t("Loading…")}</p>;

  const googleConnected = providers.includes("google");
  return (
    <Group>
      <Row
        label={t("Google")}
        value={googleConnected ? t("Connected") : t("Not connected")}
        action={
          googleConnected ? (
            <span className="text-xs text-muted-foreground">{t("Linked to this account")}</span>
          ) : (
            // Signing in with Google is not linking: the OAuth flow replaces the
            // browser session, and a different Google account would land the
            // visitor in a different account. Identity linking needs its own
            // server-side flow, so it is reported as unavailable instead.
            <span className="text-xs text-muted-foreground">{t("Linking is not implemented")}</span>
          )
        }
      />
    </Group>
  );
}

function BlockedSection({ signedIn }: { signedIn: boolean }) {
  const [list, setList] = useState<Array<{ id: string; username: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!signedIn) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    listBlocked()
      .then((entries) => {
        if (!cancelled) setList(entries);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t("Couldn't load the list."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn) return <RequireSignIn body={t("Blocked users belong to your account.")} />;
  if (loading) return <p className="px-4 text-sm text-muted-foreground">{t("Loading…")}</p>;
  if (error) {
    return (
      <div className="px-4 md:px-0">
        <ErrorState
          title={t("Couldn't load blocked users")}
          body={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
  if (list.length === 0)
    return (
      <EmptyState
        title={t("No blocked users")}
        body={t("People you block can't see your profile or comment on your scores.")}
      />
    );
  return (
    <Group>
      {list.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-4 py-3">
          <UserAvatar username={u.username} size="sm" />
          <span className="flex-1 text-sm">@{u.username}</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              unblockUser(u.id)
                .then(() => setList((prev) => prev.filter((x) => x.id !== u.id)))
                .catch((err: unknown) =>
                  setError(err instanceof Error ? err.message : t("Couldn't unblock.")),
                )
            }
          >
            {t("Unblock")}
          </Button>
        </div>
      ))}
    </Group>
  );
}

function Section() {
  const { section } = Route.useParams();
  const { category } = Route.useSearch();
  const meta = allSettings.find((s) => s.slug === section);
  return (
    <Page>
      <PageHeader back title={meta ? t(meta.title) : t("Settings")} />
      <div className="enter">
        <Body section={section} category={category} />
      </div>
    </Page>
  );
}
