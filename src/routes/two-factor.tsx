import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { listTwoFactorMethods, verifyTwoFactorCode } from "@/lib/auth/security";
import { signOut } from "@/lib/auth/session";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";
import { clearProfile } from "@/lib/users/profile";

export const Route = createFileRoute("/two-factor")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => {
    const { next } = search;
    // A path inside the app only, so this can't be used to send someone elsewhere.
    return typeof next === "string" && next.startsWith("/") && !next.startsWith("//")
      ? { next }
      : {};
  },
  head: () => seo(t("Two-step verification"), t("Enter the code from your authenticator app.")),
  component: TwoFactor,
});

/** The second step of logging in, for an account that has turned it on. */
function TwoFactor() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    listTwoFactorMethods()
      .then((methods) => {
        const method = methods.find((item) => item.verified);
        if (method) setFactorId(method.id);
        else void navigate({ to: "/", replace: true });
      })
      .catch(() => setError(t("Couldn't read your two-step settings.")));
  }, [navigate]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!factorId || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await verifyTwoFactorCode(factorId, code.trim());
      void navigate({ to: next ?? "/", replace: true });
    } catch (err) {
      setCode("");
      setError(
        err instanceof ApiError ? err.message : t("That code didn't work. Check it and try again."),
      );
    } finally {
      setBusy(false);
    }
  }

  async function logOut() {
    try {
      await signOut();
    } catch {
      // The local session is already gone.
    }
    clearProfile();
    void navigate({ to: "/login", replace: true });
  }

  return (
    <AuthLayout
      title={t("Two-step verification")}
      subtitle={t("Enter the code from your authenticator app.")}
    >
      <form className="space-y-4" onSubmit={(e) => void submit(e)}>
        <label className="block space-y-1.5" htmlFor="mfa-code">
          <span className="text-sm">{t("6-digit code")}</span>
          <input
            id="mfa-code"
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            className="h-12 w-full rounded-lg bg-surface-2 px-3 text-center text-lg tracking-[0.4em] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="play"
          size="xl"
          className="w-full"
          disabled={busy || factorId === null || code.length !== 6}
        >
          {busy ? t("Checking…") : t("Continue")}
        </Button>
        <Button type="button" variant="ghost" className="w-full" onClick={() => void logOut()}>
          {t("Log out")}
        </Button>
      </form>
    </AuthLayout>
  );
}
