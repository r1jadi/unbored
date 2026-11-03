import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useState, type FormEvent } from "react";
import * as z from "zod";
import { AuthLayout, Field, SocialButtons } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { authErrorMessage, signIn } from "@/lib/auth/session";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
const searchSchema = z.object({
  email: z.string().optional(),
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/login")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => seo(t("Log in"), t("Log in to Unbored to keep your scores and streaks.")),
  component: Login,
});

function Login() {
  const nav = useNavigate();
  const search = Route.useSearch();
  const [show, setShow] = useState(false);
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  // Credentials go to the auth service, which forwards them to Supabase. They
  // are never kept here, and the API's own message is what the user is shown.
  // A transport failure (the fetch itself threw) keeps the network message;
  // every HTTP response keeps the server's message — nothing is collapsed
  // into a single "server unavailable" string.
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) return setErr(t("Enter your email and password."));
    setErr(undefined);
    setBusy(true);
    try {
      await signIn(email, password);
      const destination = sanitizeNext(search.redirect);
      nav({ to: destination });
    } catch (error) {
      setErr(describeLoginError(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title={t("Welcome back")}
      subtitle={t("Log in to keep your scores and streaks.")}
      footer={
        <>
          {t("New to Unbored?")}{" "}
          <Link to="/signup" className="font-medium text-foreground">
            {t("Create account")}
          </Link>
        </>
      }
    >
      <SocialButtons next={sanitizeNext(search.redirect)} />
      <form className="space-y-4" onSubmit={submit}>
        <Field
          id="email"
          name="email"
          type="email"
          label={t("Email")}
          autoComplete="email"
          defaultValue={search.email ?? ""}
        />
        <div className="relative">
          <Field
            id="password"
            name="password"
            type={show ? "text" : "password"}
            label={t("Password")}
            autoComplete="current-password"
            hint={
              <Link
                to="/forgot-password"
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                {t("Forgot password?")}
              </Link>
            }
          />
          <button
            type="button"
            aria-label={show ? t("Hide password") : t("Show password")}
            onClick={() => setShow(!show)}
            className="absolute right-3 bottom-3.5 text-muted-foreground"
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        {err && (
          <p className="text-sm text-destructive" role="alert">
            {err}
          </p>
        )}
        <Button type="submit" variant="play" size="xl" className="w-full" disabled={busy}>
          {t("Log in")}
        </Button>
      </form>
    </AuthLayout>
  );
}

function sanitizeNext(value: string | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/**
 * Maps a sign-in failure onto the message the screen shows. HTTP responses
 * keep the API's own wording (unconfirmed email, wrong password, rate limit);
 * only a transport failure — the request never completed — mentions the
 * connection. A 503 naming the auth service is reported as unavailable, not
 * as a wrong password.
 */
function describeLoginError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "network_error") {
      return t("Could not reach the server. Check your connection and try again.");
    }
    return authErrorMessage(error);
  }
  return authErrorMessage(error);
}
