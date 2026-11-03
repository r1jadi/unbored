import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { useState } from "react";
import { AuthLayout, Field } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { changePassword, useAuth } from "@/lib/auth/session";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/reset-password")({
  head: () => seo(t("Set a new password"), t("Choose a new password for your Unbored account.")),
  component: Reset,
});

/**
 * Sets a new password for the recovery session established by the callback.
 * Without a session (link never opened, expired, or opened in another browser)
 * the screen says so instead of pretending to update a password.
 */
function Reset() {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const mismatch = b.length > 0 && a !== b;
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (a.length < 8 || mismatch) return;
    setError(undefined);
    setBusy(true);
    try {
      await changePassword(a);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <AuthLayout
        title={t("Password updated")}
        subtitle={t("You can now log in with your new password.")}
        back={false}
      >
        <div className="flex justify-center py-8">
          <span className="flex size-16 items-center justify-center rounded-full bg-success/15">
            <Check className="size-7 text-success" />
          </span>
        </div>
        <Button asChild variant="play" size="xl" className="mt-auto w-full lg:mt-4">
          <Link to="/login">{t("Log in")}</Link>
        </Button>
      </AuthLayout>
    );
  return (
    <AuthLayout title={t("Set a new password")} subtitle={t("Use at least 8 characters.")}>
      {!signedIn && (
        <p className="mb-4 rounded-lg bg-surface p-3 text-sm text-muted-foreground" role="note">
          {t(
            "Open the reset link from your email first — it signs you in so this screen can set the new password. Links expire; use the newest one.",
          )}
        </p>
      )}
      <form className="flex flex-1 flex-col" onSubmit={submit}>
        <div className="space-y-4">
          <Field
            id="new"
            type="password"
            label={t("New password")}
            value={a}
            onChange={(e) => setA(e.target.value)}
            autoComplete="new-password"
            error={a && a.length < 8 ? t("Use at least 8 characters.") : undefined}
          />
          <Field
            id="confirm"
            type="password"
            label={t("Confirm password")}
            value={b}
            onChange={(e) => setB(e.target.value)}
            autoComplete="new-password"
            error={mismatch ? t("Passwords don't match.") : undefined}
          />
        </div>
        {error && (
          <p className="mt-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="play"
          size="xl"
          className="mt-auto w-full lg:mt-6"
          disabled={a.length < 8 || a !== b || busy || !signedIn}
        >
          {t("Update password")}
        </Button>
      </form>
    </AuthLayout>
  );
}
