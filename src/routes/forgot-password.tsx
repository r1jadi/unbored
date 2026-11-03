import { createFileRoute, Link } from "@tanstack/react-router";
import { MailCheck } from "lucide-react";
import { useState } from "react";
import { AuthLayout, Field } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { publicConfig } from "@/lib/config";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/forgot-password")({
  head: () => seo(t("Forgot password"), t("Reset your Unbored password.")),
  component: Forgot,
});

/**
 * Password recovery via Supabase Auth. The email contains a recovery link that
 * lands on `/auth/callback` and then on `/reset-password`; this screen never
 * invents a "sent" state without calling the API.
 */
function Forgot() {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(email: string) {
    setError(undefined);
    setBusy(true);
    try {
      const base = publicConfig.supabase.url.replace(/\/+$/, "");
      const key = publicConfig.supabase.publishableKey;
      if (base === "" || key === "") {
        throw new Error(t("Password recovery is not configured for this deployment."));
      }
      const redirectTo = new URL("/auth/callback", window.location.origin);
      redirectTo.searchParams.set("next", "/reset-password");
      const response = await fetch(`${base}/auth/v1/recover`, {
        method: "POST",
        headers: { apikey: key, "Content-Type": "application/json" },
        body: JSON.stringify({ email, options: { redirectTo: redirectTo.toString() } }),
      });
      if (!response.ok) {
        throw new Error(t("We could not send the reset email. Try again shortly."));
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("Something went wrong. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <AuthLayout
        title={t("Check your inbox")}
        subtitle={t("If an account exists for that email, a reset link is on its way.")}
      >
        <div className="flex justify-center py-8">
          <MailCheck className="size-12 text-muted-foreground" strokeWidth={1.5} />
        </div>
        <div className="mt-auto space-y-2 lg:mt-4">
          <Button asChild variant="secondary" size="lg" className="w-full">
            <Link to="/login">{t("Back to log in")}</Link>
          </Button>
          <Button variant="ghost" size="lg" className="w-full" onClick={() => setSent(false)}>
            {t("Use a different email")}
          </Button>
        </div>
      </AuthLayout>
    );
  return (
    <AuthLayout
      title={t("Reset your password")}
      subtitle={t("Enter your email and we'll send you a link.")}
      footer={
        <Link to="/login" className="font-medium text-foreground">
          {t("Back to log in")}
        </Link>
      }
    >
      <form
        className="flex flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const email = String(f.get("email") ?? "").trim();
          if (email === "") {
            setError(t("Enter your email address."));
            return;
          }
          void submit(email);
        }}
      >
        <Field
          id="email"
          name="email"
          type="email"
          label={t("Email")}
          required
          autoComplete="email"
        />
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
          disabled={busy}
        >
          {t("Send reset link")}
        </Button>
      </form>
    </AuthLayout>
  );
}
