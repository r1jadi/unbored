import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  FileText,
  Loader2,
  Mail,
  Shield,
  XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { AuthLayout, Field, SocialButtons } from "@/components/auth/AuthLayout";
import { LegalBody, privacy, terms } from "@/components/legal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ApiError } from "@/lib/api/client";
import { authErrorMessage, loadSession, signOut, signUp, useAuth } from "@/lib/auth/session";
import { useProfile } from "@/lib/users/profile";
import { completeRegistration } from "@/lib/users/registration";
import {
  normalizeUsername,
  useUsernameAvailability,
  usernameStatusMessage,
  usernameValidationMessage,
} from "@/lib/users/username";
import { seo } from "@/lib/seo";
import {
  readWithLegacy,
  removeWithLegacy,
  safeLocalStorage,
  safeSessionStorage,
} from "@/lib/storage";
import { cn } from "@/lib/utils";

import { t, msg } from "@/lib/settings/language";
export const Route = createFileRoute("/signup")({
  head: () => seo(t("Create account"), t("Create your Unbored account in under a minute.")),
  component: Signup,
});

const titles = [
  [msg("Create your account"), msg("Step 1 of 3")],
  [msg("Choose your name"), msg("Step 2 of 3 · This is how others see you.")],
  [msg("Before you start"), msg("Step 3 of 3 · Please review and accept.")],
];

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/**
 * Where a display name is kept while email confirmation is pending. Local, not
 * session, storage: the confirmation link opens in a new tab, which has an empty
 * session storage. The server copy (sign-up metadata) is the primary record;
 * this only covers a database that has not learned to read it yet.
 */
const PENDING_DISPLAY_NAME_KEY = "unbored-pending-display-name";
/** Pre-rename key: read once and moved forward by `readWithLegacy`. */
const LEGACY_PENDING_DISPLAY_NAME_KEY = "onemore-pending-display-name";

function storedPendingDisplayName(): string {
  return (
    readWithLegacy(safeLocalStorage(), PENDING_DISPLAY_NAME_KEY, LEGACY_PENDING_DISPLAY_NAME_KEY) ??
    readWithLegacy(
      safeSessionStorage(),
      PENDING_DISPLAY_NAME_KEY,
      LEGACY_PENDING_DISPLAY_NAME_KEY,
    ) ??
    ""
  );
}

function rememberPendingDisplayName(name: string): void {
  try {
    localStorage.setItem(PENDING_DISPLAY_NAME_KEY, name);
  } catch {
    // Best effort only; the profile screen lets the user set it later.
  }
}

function forgetPendingDisplayName(): void {
  // Both keys in both stores: a stale copy would restore the forgotten name.
  for (const storage of [safeLocalStorage(), safeSessionStorage()]) {
    removeWithLegacy(storage, PENDING_DISPLAY_NAME_KEY, LEGACY_PENDING_DISPLAY_NAME_KEY);
  }
}

/** The icon that matches the availability line under the username input. */
function UsernameStatusIcon({
  status,
  hasError,
}: {
  status: ReturnType<typeof useUsernameAvailability>["status"];
  hasError: boolean;
}) {
  if (hasError || status.state === "taken") {
    return <XCircle className="size-3.5 shrink-0" aria-hidden />;
  }
  switch (status.state) {
    case "available":
      return <CheckCircle2 className="size-3.5 shrink-0" aria-hidden />;
    case "checking":
      return <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden />;
    case "invalid":
    case "error":
      return <AlertCircle className="size-3.5 shrink-0" aria-hidden />;
    case "empty":
      return null;
  }
}

function Signup() {
  const nav = useNavigate();
  const auth = useAuth();
  const [step, setStep] = useState(0);
  const [accept, setAccept] = useState({ terms: false, privacy: false, marketing: false });
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [nameError, setNameError] = useState<string>();
  const [username, setUsername] = useState("");
  const [usernameError, setUsernameError] = useState<string>();
  // Bumped after the server refuses a name, so the availability hook looks it
  // up again even though the input did not change.
  const [usernameCheck, setUsernameCheck] = useState(0);
  const { status: usernameStatus } = useUsernameAvailability(username, usernameCheck);
  const profileState = useProfile();
  const [creds, setCreds] = useState<{ email: string; password: string }>();
  const [credError, setCredError] = useState<string>();
  const [err, setErr] = useState<string>();
  const [errCode, setErrCode] = useState<string>();
  const [busy, setBusy] = useState(false);

  // A signed-in account that has not finished signing up — a Google sign-in, or
  // an email whose confirmation link was just opened — completes here: the
  // credential step is already done, so what remains is the name and the terms.
  // The database decides (`onboarded_at` through the session), never a local
  // guess, so a reload mid-way lands back on the same step.
  const completing = auth.status === "authenticated" && auth.session.onboarded === false;
  // On the completion path the account (and its profile row) already exists with
  // a username the sign-up trigger wrote — for a Google sign-up, a generated one.
  // It is offered as the starting value and can be changed here: a different one
  // is checked for availability like any chosen at sign-up, then written with the
  // display name.
  const storedUsername =
    completing && profileState.status === "ready" ? profileState.profile.username : undefined;
  const chosenUsername = normalizeUsername(username);
  // Keeping the stored username needs no availability check: it is already ours.
  const keepingStored =
    completing && storedUsername !== undefined && chosenUsername === storedUsername;
  const usernameUsable =
    keepingStored ||
    (usernameStatus.state === "available" && usernameStatus.username === chosenUsername);
  const usernameMessage =
    usernameError ??
    (keepingStored ? t("This is your current username.") : usernameStatusMessage(usernameStatus));
  const usernameTone =
    usernameError !== undefined ||
    (!keepingStored &&
      (usernameStatus.state === "taken" ||
        usernameStatus.state === "invalid" ||
        usernameStatus.state === "error"))
      ? "text-destructive"
      : !keepingStored && usernameStatus.state === "available"
        ? "text-primary"
        : "text-muted-foreground";
  // Signing in to an account that already exists must never lead back into the
  // registration form: there is nothing to create, and asking for a password
  // for an email that already has an account is exactly how a duplicate
  // registration gets attempted. `onboarded === undefined` is not "new" — it
  // means the server could not read the marker — so it is treated as existing
  // too and offered the idempotent completion instead.
  const alreadyRegistered = auth.status === "authenticated" && !completing;

  useEffect(() => {
    if (!completing) return;
    setStep((current) => (current === 0 ? 1 : current));
    setDisplayName((current) => (current === "" ? storedPendingDisplayName() : current));
  }, [completing]);

  // The stored username fills the field once it has loaded, and never overwrites
  // what the person has already typed.
  useEffect(() => {
    if (storedUsername === undefined) return;
    setUsername((current) => (current === "" ? storedUsername : current));
  }, [storedUsername]);

  // A fresh "taken" answer is more precise than the server's refusal text that
  // sent the visitor back here; keep the field in sync with what the check now
  // knows.
  useEffect(() => {
    if (usernameStatus.state === "taken") setUsernameError(undefined);
  }, [usernameStatus.state]);

  // The credential is collected in step 1 and held until the account is created
  // in step 3, because the account itself is only made once the terms are
  // accepted. It is forwarded to Supabase by the auth service and never stored.
  // The username is chosen in step 2 and travels with the sign-up request: the
  // auth service validates it again, then Supabase stores it on the auth user so
  // the profile trigger writes it in the same transaction as the account.
  async function createAccount() {
    if (completing) {
      // The Supabase account (and its profile row, created by the database
      // trigger) already exists; only the registration marker is missing.
      await finishRegistration();
      return;
    }
    if (!creds) return setErr(t("Enter your email and password to start again."));
    if (!usernameUsable) {
      // The button is disabled in this state, so this is a safety net for a
      // stale render: never create an account with a name that was not cleared.
      setUsernameCheck((value) => value + 1);
      setUsernameError(usernameStatusMessage(usernameStatus));
      setStep(1);
      return;
    }
    setErr(undefined);
    setBusy(true);
    try {
      const name = displayName.trim();
      // The name travels with the request: the database stores it and records
      // the registration as finished, so the confirmation link signs straight
      // in. The local copy only covers a database without that migration.
      const result = await signUp(
        creds.email,
        creds.password,
        chosenUsername,
        name,
        accept.marketing,
      );
      if (name !== "") rememberPendingDisplayName(name);
      if (result.tokens) {
        await finishRegistration();
      } else {
        nav({ to: "/verify-email", search: { email: creds.email } });
      }
    } catch (error) {
      // A field-attributed username failure means the name was claimed between
      // the availability check and this request (or the server rejected it).
      // Nothing was created — the trigger fails the whole registration — so the
      // visitor goes back to the name step with a fresh check, never to a form
      // that silently registers a different username.
      const usernameProblem =
        error instanceof ApiError && error.details.some((detail) => detail.field === "username");
      if (usernameProblem) {
        setErr(undefined);
        setErrCode(undefined);
        setUsernameError(error.message);
        setUsernameCheck((value) => value + 1);
        setStep(1);
        return;
      }

      // The API answers a duplicate registration with 409 `conflict`. Its
      // message is the one the screen shows, and the link below turns it into
      // the next step rather than a dead end. The check is on the status and
      // code, not the wording, so a translated or re-worded message still maps.
      const duplicate =
        error instanceof ApiError && (error.status === 409 || error.code === "conflict");
      setErr(
        duplicate
          ? t("An account with this email already exists. Please sign in instead.")
          : authErrorMessage(error),
      );
      setErrCode(duplicate ? "conflict" : error instanceof ApiError ? error.code : "unknown_error");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Records the registration exactly once: the display name goes through the
   * users API and the marker through the database (see
   * `lib/users/registration`). The session view is re-read afterwards so the
   * screen the app shows next reflects the server's answer, not a local one.
   */
  async function finishRegistration() {
    setErr(undefined);
    setBusy(true);
    try {
      await completeRegistration(
        displayName.trim(),
        completing && !keepingStored ? chosenUsername : undefined,
      );
      forgetPendingDisplayName();
      await loadSession();
      nav({ to: "/account-created" });
    } catch (error) {
      // A username the server refused (taken in the meantime, or malformed) sends
      // the person back to the name step, where the field can be fixed.
      if (
        completing &&
        error instanceof ApiError &&
        error.details.some((detail) => detail.field === "username")
      ) {
        setErr(undefined);
        setErrCode(undefined);
        setUsernameError(error.message);
        setUsernameCheck((value) => value + 1);
        setStep(1);
        return;
      }
      setErr(authErrorMessage(error));
      setErrCode(error instanceof ApiError ? error.code : "unknown_error");
    } finally {
      setBusy(false);
    }
  }

  // A completed account is not sent back through registration. The signed-in
  // identity is the answer to "does this account exist?", and offering a form
  // that would create a second one is the bug this screen used to have.
  if (alreadyRegistered) {
    return (
      <AuthLayout
        title={t("You're already signed in")}
        subtitle={
          auth.status === "authenticated" && auth.session.email
            ? t("Signed in as {email}.", { email: auth.session.email })
            : t("This browser already has a session.")
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t(
              "This account already exists, so there is nothing to register again. Continue to your profile, or log out first if you meant to create a different account.",
            )}
          </p>
          {err && (
            <p className="text-sm text-destructive" role="alert">
              {err}
            </p>
          )}
          <div className="grid gap-2">
            <Button asChild variant="play" size="xl" className="w-full">
              <Link to="/profile">{t("Go to your profile")}</Link>
            </Button>
            {auth.status === "authenticated" && auth.session.onboarded === undefined && (
              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => void finishRegistration()}
              >
                {t("Finish setting up my account")}
              </Button>
            )}
            <Button
              variant="ghost"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={() => {
                // The local session is cleared even if revoking it fails.
                void signOut().catch(() => undefined);
              }}
            >
              {t("Log out and create a different account")}
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t(titles[step][0])}
      subtitle={t(titles[step][1])}
      footer={
        step === 0 && (
          <>
            {t("Already have an account?")}{" "}
            <Link to="/login" className="font-medium text-foreground">
              {t("Log in")}
            </Link>
          </>
        )
      }
    >
      <div className="mb-6 flex gap-1.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-primary" : "bg-surface-2")}
          />
        ))}
      </div>

      {step === 0 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const email = String(f.get("email") ?? "").trim();
            const password = String(f.get("password") ?? "");
            if (!isValidEmail(email)) {
              setCredError(t("Enter a valid email address."));
              return;
            }
            if (password.length < 8) {
              setCredError(t("Use at least 8 characters for your password."));
              return;
            }
            setCredError(undefined);
            setCreds({ email, password });
            setStep(1);
          }}
        >
          <SocialButtons />
          <div className="space-y-4">
            <Field
              id="email"
              name="email"
              type="email"
              label={t("Email")}
              required
              autoComplete="email"
              defaultValue={creds?.email ?? ""}
            />
            <Field
              id="password"
              name="password"
              type="password"
              label={t("Password")}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              {t("At least 8 characters, with a number.")}
            </p>
            {credError && (
              <p className="text-sm text-destructive" role="alert">
                {credError}
              </p>
            )}
          </div>
          <Button type="submit" variant="play" size="xl" className="mt-auto w-full lg:mt-6">
            {t("Continue")}
          </Button>
        </form>
      )}

      {step === 1 && (
        <form
          className="flex flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            const value = displayName.trim();
            if (value === "") {
              setNameError(t("Add a display name — this is how others see you."));
              return;
            }
            if (value.length > 60) {
              setNameError(t("Keep the display name to 60 characters or fewer."));
              return;
            }
            setNameError(undefined);

            if (completing ? !keepingStored : true) {
              // The same rule the API and the database apply. Format problems
              // are reported here; a name the check has not cleared (or has
              // cleared for a different value) never moves the form forward.
              const format = usernameValidationMessage(chosenUsername);
              if (format) {
                setUsernameError(format);
                return;
              }
              if (!usernameUsable) {
                setUsernameError(usernameStatusMessage(usernameStatus));
                return;
              }
              // Show exactly what will be stored: normalized once, here.
              setUsername(chosenUsername);
            }
            setUsernameError(undefined);
            setStep(2);
          }}
        >
          <div className="space-y-4">
            <Field
              id="display"
              label={t("Display name")}
              required
              autoComplete="name"
              maxLength={60}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              error={nameError}
            />

            <div className="space-y-1.5">
              <Label htmlFor="username">{t("Username")}</Label>
              <Input
                id="username"
                name="username"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                value={username}
                onChange={(e) => {
                  // Normalization while typing keeps what is on screen equal
                  // to what would be stored (and what the check asked about).
                  setUsername(e.target.value.toLowerCase());
                  setUsernameError(undefined);
                }}
                aria-invalid={
                  usernameError !== undefined ||
                  usernameStatus.state === "invalid" ||
                  usernameStatus.state === "taken" ||
                  usernameStatus.state === "error"
                }
                aria-describedby="username-status"
                className="h-12 rounded-lg bg-surface text-base md:text-sm"
              />
              <p
                id="username-status"
                role="status"
                aria-live="polite"
                className={cn("flex items-center gap-1.5 text-xs", usernameTone)}
              >
                <UsernameStatusIcon
                  status={usernameStatus}
                  hasError={usernameError !== undefined}
                />
                {usernameMessage}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(
                "Three to 24 letters, numbers or underscores. This is how others find you; it is unique, so capitals are stored in lowercase.",
              )}
            </p>
          </div>
          <Button
            type="submit"
            variant="play"
            size="xl"
            className="mt-auto w-full lg:mt-6"
            disabled={!usernameUsable}
          >
            {t("Continue")}
          </Button>
        </form>
      )}

      {step === 2 && (
        <div className="flex flex-1 flex-col">
          <div className="space-y-2">
            {(
              [
                [
                  "terms",
                  t("Terms & Conditions"),
                  t("Required · Rules for using Unbored"),
                  FileText,
                  true,
                ],
                [
                  "privacy",
                  t("Privacy Policy"),
                  t("Required · How we handle your data"),
                  Shield,
                  true,
                ],
                [
                  "marketing",
                  t("Product updates"),
                  t("Optional · Occasional emails about new games"),
                  Mail,
                  false,
                ],
              ] as const
            ).map(([key, label, desc, Icon, isDoc]) => {
              const on = accept[key];
              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-xl border p-4 transition-colors duration-150",
                    on ? "border-primary bg-primary/5" : "border-border bg-surface",
                  )}
                >
                  <label className="flex cursor-pointer items-start gap-3">
                    <Icon
                      className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                      strokeWidth={1.75}
                    />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{t(label)}</span>
                      <span className="text-xs text-muted-foreground">{t(desc)}</span>
                    </span>
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={on}
                      onChange={() => setAccept({ ...accept, [key]: !on })}
                    />
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {on && <Check className="size-4" />}
                    </span>
                  </label>
                  {isDoc && (
                    <button
                      type="button"
                      onClick={() => setDoc(key as "terms" | "privacy")}
                      className="mt-2 ml-8 text-xs font-medium underline underline-offset-4"
                    >
                      {t("Read {label}", { label: t(label) })}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {err && (
            <div className="mt-4 text-sm text-destructive" role="alert">
              <p>{err}</p>
              {errCode === "conflict" && creds && (
                <Link
                  to="/login"
                  search={{ email: creds.email }}
                  className="mt-1 inline-block font-medium underline underline-offset-4"
                >
                  {t("Sign in instead")}
                </Link>
              )}
              {errCode === "email_not_confirmed" && creds && (
                <Link
                  to="/verify-email"
                  search={{ email: creds.email }}
                  className="mt-1 inline-block font-medium underline underline-offset-4"
                >
                  {t("Resend the confirmation email")}
                </Link>
              )}
            </div>
          )}
          <p className="mt-4 text-xs text-muted-foreground">
            {t("You must be 13 or older to use Unbored.")}
          </p>
          <Button
            variant="play"
            size="xl"
            className="mt-auto w-full lg:mt-6"
            disabled={!accept.terms || !accept.privacy || busy}
            onClick={createAccount}
          >
            {t("Agree and create account")}
          </Button>
        </div>
      )}

      <Sheet open={!!doc} onOpenChange={(o) => !o && setDoc(null)}>
        <SheetContent
          side="bottom"
          className="mx-auto flex h-[85dvh] max-w-xl flex-col rounded-t-2xl"
        >
          <SheetHeader>
            <SheetTitle>
              {doc === "terms" ? t("Terms & Conditions") : t("Privacy Policy")}
            </SheetTitle>
            <SheetDescription className="sr-only">{t("Legal document")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4">
            <LegalBody sections={doc === "terms" ? terms : privacy} />
          </div>
          <div className="p-4">
            <Button
              size="lg"
              className="w-full"
              onClick={() => {
                if (doc) setAccept({ ...accept, [doc]: true });
                setDoc(null);
              }}
            >
              {t("I accept")}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </AuthLayout>
  );
}
