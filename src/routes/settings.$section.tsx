import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { Check, ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Avatar, EmptyState, ErrorState, Page, PageHeader, UserAvatar } from "@/components/common";
import { LegalBody, privacy, terms } from "@/components/legal";
import { allSettings } from "@/components/settings/config";
import { ProfileForm } from "@/components/settings/ProfileForm";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import { changePassword, fetchLinkedProviders, signOut, useAuth } from "@/lib/auth/session";
import { offeredLanguages, useLanguage } from "@/lib/settings/language";
import { useTheme, type Appearance } from "@/lib/settings/theme";
import { useAccessibility } from "@/lib/settings/accessibility";
import {
  defaultPreferences,
  loadPreferences,
  savePreferences,
  type UserPreferences,
} from "@/lib/settings/preferences";
import { listBlocked, unblockUser } from "@/lib/settings/blocked";
import { avatarUrl, clearProfile, useProfile } from "@/lib/users/profile";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings/$section")({
  head: ({ params }) => {
    const item = allSettings.find((s) => s.slug === params.section);
    const t = item?.title;
    // An unknown section has no name of its own; without the guard the title
    // reads "Settings settings — Unbored". Pages that are not settings as such
    // (Help, the legal pages, About) carry their own `pageTitle`.
    const pageTitle = item ? (item.pageTitle ?? `${item.title} settings`) : "Settings";
    return {
      meta: [
        { title: `${pageTitle} — Unbored` },
        {
          name: "description",
          content: t ? `Manage ${t.toLowerCase()} on Unbored.` : "Manage your Unbored settings.",
        },
        { property: "og:title", content: t ? `${t} — Unbored` : "Settings — Unbored" },
        {
          property: "og:description",
          content: t ? `Manage ${t.toLowerCase()} on Unbored.` : "Manage your Unbored settings.",
        },
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
      setError(err instanceof Error ? err.message : "Couldn't save. Try again.");
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
        title="Sign in to manage settings"
        body={body}
        action={
          <Button asChild>
            <Link to="/login" search={{ redirect: path }}>
              Log in
            </Link>
          </Button>
        }
      />
    </div>
  );
}

const faq = [
  [
    "How do I create an account?",
    "Use Sign up with an email and password, open the confirmation link we email you, then log in. Google sign-in is available from the same screens once the provider is enabled.",
  ],
  [
    "How are scores verified?",
    "Play sessions are created by the server and scores are recorded against them. Only published games appear on leaderboards.",
  ],
  [
    "How do I follow a creator?",
    "Open their profile or find them in Search and use Follow. Your Following feed shows published games by creators you follow.",
  ],
  [
    "How do I report a player?",
    "Open their profile, tap the menu, and choose Report. Reports are reviewed by moderators.",
  ],
  [
    "How do I delete my account?",
    "Settings → Delete account explains the current process. Deletion removes your profile and social relationships; scores on public leaderboards are retained without attribution where required.",
  ],
];

function Body({ section }: { section: string }) {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const { prefs, loading, error, update } = usePrefs();
  const { language, setLanguage } = useLanguage();
  const { choice, setChoice } = useTheme();
  const { prefs: a11y, setPrefs: setA11y } = useAccessibility();

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
      if (!signedIn) return <RequireSignIn body="Privacy choices belong to your account." />;
      if (loading) return <p className="px-4 text-sm text-muted-foreground">Loading…</p>;
      return (
        <>
          <Group title="Visibility">
            <Toggle
              id="p1"
              label="Private account"
              desc="Only approved followers see your activity"
              checked={prefs.privateAccount}
              onChange={(v) => void update({ ...prefs, privateAccount: v })}
            />
            <Toggle
              id="p2"
              label="Show on leaderboards"
              checked={prefs.showOnLeaderboards}
              onChange={(v) => void update({ ...prefs, showOnLeaderboards: v })}
            />
            <Toggle
              id="p3"
              label="Show recently played"
              checked={prefs.showRecentlyPlayed}
              onChange={(v) => void update({ ...prefs, showRecentlyPlayed: v })}
            />
          </Group>
          <Group title="Interactions">
            <Toggle
              id="p4"
              label="Allow comments on my scores"
              checked={prefs.allowComments}
              onChange={(v) => void update({ ...prefs, allowComments: v })}
            />
            <Toggle
              id="p5"
              label="Allow mentions"
              checked={prefs.allowMentions}
              onChange={(v) => void update({ ...prefs, allowMentions: v })}
            />
            <Toggle
              id="p6"
              label="Personalised recommendations"
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
        return <RequireSignIn body="Notification preferences belong to your account." />;
      if (loading) return <p className="px-4 text-sm text-muted-foreground">Loading…</p>;
      return (
        <>
          <Group title="In-app">
            <Toggle
              id="n1"
              label="Someone beats your score"
              checked={prefs.notifyBeats}
              onChange={(v) => void update({ ...prefs, notifyBeats: v })}
            />
            <Toggle
              id="n2"
              label="New followers"
              checked={prefs.notifyFollowers}
              onChange={(v) => void update({ ...prefs, notifyFollowers: v })}
            />
            <Toggle
              id="n3"
              label="Comments and replies"
              checked={prefs.notifyComments}
              onChange={(v) => void update({ ...prefs, notifyComments: v })}
            />
          </Group>
          <Group title="Push & email">
            <Row
              label="Push notifications"
              value="Not available"
              action={
                <span className="text-xs text-muted-foreground">
                  No push delivery is implemented
                </span>
              }
            />
            <Row
              label="Email updates"
              value="Not available"
              action={
                <span className="text-xs text-muted-foreground">No email delivery implemented</span>
              }
            />
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
        <div className="grid gap-2 px-4 md:px-0" role="radiogroup" aria-label="Language">
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
                <span className="text-xs text-muted-foreground">{option.label}</span>
              </span>
              {language === option.code && <Check className="size-4 text-primary" />}
            </button>
          ))}
        </div>
      );
    case "appearance": {
      const options: Array<{ value: Appearance; desc: string }> = [
        { value: "dark", desc: "Default. Best for playing at night." },
        { value: "light", desc: "Light surfaces for bright rooms." },
        { value: "system", desc: "Follow your device setting" },
      ];
      const labels: Record<Appearance, string> = { dark: "Dark", light: "Light", system: "System" };
      return (
        <div className="grid gap-2 px-4 md:px-0" role="radiogroup" aria-label="Appearance">
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
          <Group title="Motion">
            <Toggle
              id="a1"
              label="Reduce motion"
              desc="Minimise animations across the app"
              checked={a11y.reduceMotion}
              onChange={(v) => setA11y({ ...a11y, reduceMotion: v })}
            />
          </Group>
          <Group title="Display">
            <Toggle
              id="a3"
              label="Increase contrast"
              checked={a11y.increaseContrast}
              onChange={(v) => setA11y({ ...a11y, increaseContrast: v })}
            />
            <Toggle
              id="a4"
              label="Larger text"
              checked={a11y.largerText}
              onChange={(v) => setA11y({ ...a11y, largerText: v })}
            />
          </Group>
          <p className="mt-3 px-4 text-xs text-muted-foreground md:px-0">
            Changes apply immediately and are remembered on this device.
          </p>
        </>
      );
    case "connected":
      return <ConnectedSection signedIn={signedIn} />;
    case "blocked":
      return <BlockedSection signedIn={signedIn} />;
    case "help":
      return (
        <>
          <Group title="Frequently asked">
            {faq.map(([q, a]) => (
              <details key={q} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
                  {q}
                  <ChevronDown className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{a}</p>
              </details>
            ))}
          </Group>
          <div className="mt-4 px-4 md:px-0">
            <p className="text-sm text-muted-foreground">
              Still stuck, or found a bug? Tell us on our issue tracker and we&apos;ll take a look.
            </p>
            <Button asChild size="lg" className="mt-3 w-full md:w-auto">
              <a href="https://github.com/r1jadi/unbored/issues" target="_blank" rel="noreferrer">
                Open an issue
              </a>
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
          <Row label="Version" value={import.meta.env?.["VITE_APP_VERSION"] || "0.1.0"} />
          <Row
            label="Source"
            action={
              <Button asChild size="sm" variant="ghost">
                <a href="https://github.com/r1jadi/unbored" target="_blank" rel="noreferrer">
                  View
                </a>
              </Button>
            }
          />
          <Row label="Website" value="unbored.lol" />
        </Group>
      );
    default:
      return (
        <EmptyState
          title="Setting not found"
          action={
            <Button asChild variant="secondary">
              <Link to="/settings">Back to settings</Link>
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

  if (!signedIn) return <RequireSignIn body="Your account details belong to your account." />;

  if (profile.status === "ready") {
    return (
      <>
        <Group title="Login">
          <Row label="Email" value={maskEmail(email || "unknown")} />
          <Row
            label="Password"
            value="Set at signup"
            action={
              <Button asChild size="sm" variant="ghost">
                <Link to="/reset-password">Change</Link>
              </Button>
            }
          />
        </Group>
        <Group title="Profile">
          <div className="flex items-center gap-3 px-4 py-3">
            <Avatar name={profile.profile.username} src={avatarUrl(profile.profile)} size="sm" />
            <span className="flex-1 text-sm">
              {profile.profile.displayName} · @{profile.profile.username}
            </span>
            <Button asChild size="sm" variant="ghost">
              <Link to="/settings/$section" params={{ section: "profile" }}>
                Edit
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
          title="Couldn't load your account"
          body={profile.error.message}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
  return <p className="px-4 text-sm text-muted-foreground">Loading your account…</p>;
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

  if (!signedIn) return <RequireSignIn body="Security controls belong to your account." />;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("Use at least 8 characters for your password.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setError(undefined);
    setStatus(undefined);
    setBusy(true);
    try {
      await changePassword(password);
      setStatus("Password updated.");
      setPassword("");
      setConfirm("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't update the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Group title="Password">
        <form className="space-y-3 px-4 py-3" onSubmit={submit}>
          <label className="block space-y-1.5" htmlFor="new-password">
            <span className="text-sm">New password</span>
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
          <p className="text-xs text-muted-foreground">At least 8 characters.</p>
          <label className="block space-y-1.5" htmlFor="confirm-password">
            <span className="text-sm">Confirm password</span>
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
            Update password
          </Button>
        </form>
      </Group>
      <Group title="Sessions">
        <Row
          label="This device"
          value="Current session"
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
              Log out
            </Button>
          }
        />
        <Row
          label="Other sessions"
          value="Use log out on each device"
          action={
            <span className="text-xs text-muted-foreground">
              Per-device session list is not implemented
            </span>
          }
        />
      </Group>
      <p className="mt-3 px-4 text-xs text-muted-foreground md:px-0">
        Two-step verification is not implemented — it is not offered here rather than shown as a
        toggle that does nothing.
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

  if (!signedIn) return <RequireSignIn body="Connected accounts belong to your account." />;
  if (!loaded) return <p className="px-4 text-sm text-muted-foreground">Loading…</p>;

  const googleConnected = providers.includes("google");
  return (
    <Group>
      <Row
        label="Google"
        value={googleConnected ? "Connected" : "Not connected"}
        action={
          googleConnected ? (
            <span className="text-xs text-muted-foreground">Linked to this account</span>
          ) : (
            // Signing in with Google is not linking: the OAuth flow replaces the
            // browser session, and a different Google account would land the
            // visitor in a different account. Identity linking needs its own
            // server-side flow, so it is reported as unavailable instead.
            <span className="text-xs text-muted-foreground">Linking is not implemented</span>
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
        if (!cancelled) setError(err instanceof Error ? err.message : "Couldn't load the list.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn) return <RequireSignIn body="Blocked users belong to your account." />;
  if (loading) return <p className="px-4 text-sm text-muted-foreground">Loading…</p>;
  if (error) {
    return (
      <div className="px-4 md:px-0">
        <ErrorState
          title="Couldn't load blocked users"
          body={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }
  if (list.length === 0)
    return (
      <EmptyState
        title="No blocked users"
        body="People you block can't see your profile or comment on your scores."
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
                  setError(err instanceof Error ? err.message : "Couldn't unblock."),
                )
            }
          >
            Unblock
          </Button>
        </div>
      ))}
    </Group>
  );
}

function Section() {
  const { section } = Route.useParams();
  const meta = allSettings.find((s) => s.slug === section);
  return (
    <Page>
      <PageHeader back title={meta?.title ?? "Settings"} />
      <div className="enter">
        <Body section={section} />
      </div>
    </Page>
  );
}
