import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { authErrorMessage, resendConfirmation } from "@/lib/auth/session";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/verify-email")({
  validateSearch: (search: Record<string, unknown>) => ({
    email: typeof search["email"] === "string" ? (search["email"] as string) : undefined,
  }),
  head: () =>
    seo(t("Verify your email"), t("Confirm your email address to finish creating your account.")),
  component: Verify,
});

/**
 * Confirmation-pending state for the link flow Supabase actually sends.
 *
 * Supabase delivers a verification *link*, not a six-digit code, so this
 * screen explains the link, offers a resend, and points to sign-in once the
 * link has been opened. It never claims the account is verified and never
 * accepts a code as proof.
 */
function Verify() {
  const { email } = Route.useSearch();
  const nav = useNavigate();
  const [address, setAddress] = useState(email ?? "");
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function resend() {
    const value = address.trim();
    if (value === "") {
      setError(t("Enter the email address you signed up with."));
      return;
    }
    setError(undefined);
    setStatus(undefined);
    setBusy(true);
    try {
      await resendConfirmation(value);
      setStatus(t("If that address is waiting for confirmation, a new link is on its way."));
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t("Check your email")}
      subtitle={
        address
          ? t("We sent a confirmation link to {address}. Open it to verify your address.", {
              address,
            })
          : t("We sent you a confirmation link. Open it to verify your address.")
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          {t(
            "The email contains a link — not a code. Clicking it opens Unbored and signs you in automatically. If you already opened the link, continue to log in.",
          )}
        </p>
        <label className="block space-y-1.5" htmlFor="verify-email">
          <span className="text-sm font-medium">{t("Email")}</span>
          <input
            id="verify-email"
            type="email"
            autoComplete="email"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@example.com"
            className="h-12 w-full rounded-lg bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring md:text-sm"
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
        <div className="grid gap-2">
          <Button variant="secondary" size="lg" className="w-full" disabled={busy} onClick={resend}>
            {t("Resend confirmation link")}
          </Button>
          <Button
            variant="play"
            size="xl"
            className="w-full"
            onClick={() => nav({ to: "/login", search: address ? { email: address } : undefined })}
          >
            {t("Continue to log in")}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            {t("Didn't get the email? Check spam, then resend. Links expire — use the newest one.")}{" "}
            <Link to="/signup" className="underline underline-offset-4">
              {t("Start over")}
            </Link>
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
