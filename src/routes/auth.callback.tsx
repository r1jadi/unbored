import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import * as z from "zod";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import {
  adoptSupabaseTokens,
  authErrorMessage,
  exchangeOAuthCode,
  verifyEmailLink,
} from "@/lib/auth/session";
import { seo } from "@/lib/seo";

import { sanitizeNext } from "@/lib/auth/next";
import { t } from "@/lib/settings/language";
const searchSchema = z.object({
  code: z.string().optional(),
  token_hash: z.string().optional(),
  type: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
  next: z.string().optional(),
});

export const Route = createFileRoute("/auth/callback")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => seo(t("Confirming"), t("Finishing email confirmation.")),
  component: Callback,
});

type Outcome =
  | { status: "working" }
  | { status: "done"; next: string; onboarded?: boolean }
  | { status: "confirmed-no-session"; next: string }
  | { status: "failed"; message: string };

/**
 * Where a completed sign-in lands.
 *
 * An account whose registration is unfinished finishes it at `/signup` — that
 * is the one screen that can record the marker. An account that already
 * finished goes wherever it was headed. The two cases are decided here, from
 * the server's session view, so a returning Google user never has to walk back
 * through registration to get in, and a new one is not dropped into the app
 * half-registered.
 */
function destinationFor(next: string, onboarded: boolean | undefined): string {
  if (onboarded === false) return "/signup";
  if (next === "/signup" || next.startsWith("/signup?")) return "/profile";
  return next;
}

/**
 * Email-verification and OAuth callback.
 *
 * Handles the formats Supabase actually returns:
 * - `?token_hash=…&type=signup|email|recovery` (email link, verified via
 *   `POST /auth/v1/verify`, then exchanged for the app session);
 * - `?code=…` (PKCE: OAuth or the newer email-link code flow, exchanged with
 *   the stored verifier, then exchanged for the app session);
 * - `#access_token=…&refresh_token=…` (implicit fragment, verified by the
 *   backend before it is trusted).
 *
 * Callback parameters are removed from the visible URL as soon as the outcome
 * is known. Arbitrary parameters are never treated as proof of authentication.
 */
function Callback() {
  const search = Route.useSearch();
  const nav = useNavigate();
  const [outcome, setOutcome] = useState<Outcome>({ status: "working" });
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;

    async function run(): Promise<Outcome> {
      const next = sanitizeNext(search.next);
      if (search.error) {
        return {
          status: "failed",
          message: describeOAuthError(search.error, search.error_description),
        };
      }
      // Fragment flow (`#access_token=…`): Supabase implicit redirect.
      const fragment = parseFragment(window.location.hash);
      if (fragment["access_token"] && fragment["refresh_token"]) {
        try {
          const adopted = await adoptSupabaseTokens({
            accessToken: fragment["access_token"],
            refreshToken: fragment["refresh_token"],
          });
          return {
            status: "done",
            next: destinationFor(next, adopted.session.onboarded),
            onboarded: adopted.session.onboarded,
          };
        } catch (error) {
          return { status: "failed", message: authErrorMessage(error) };
        }
      }
      if (search.token_hash && search.type) {
        try {
          const pair = await verifyEmailLink(search.token_hash, search.type);
          const adopted = await adoptSupabaseTokens(pair);
          return {
            status: "done",
            next: destinationFor(next, adopted.session.onboarded),
            onboarded: adopted.session.onboarded,
          };
        } catch (error) {
          return { status: "failed", message: authErrorMessage(error) };
        }
      }
      if (search.code) {
        try {
          const adopted = await exchangeOAuthCode(search.code);
          return {
            status: "done",
            next: destinationFor(next, adopted.session.onboarded),
            onboarded: adopted.session.onboarded,
          };
        } catch (error) {
          return { status: "failed", message: authErrorMessage(error) };
        }
      }
      return {
        status: "failed",
        message: t("That link is missing its confirmation details. Request a new one."),
      };
    }

    void run().then((result) => {
      // Strip tokens from the address bar before rendering the outcome.
      try {
        const clean = new URL(window.location.href);
        for (const key of ["code", "token_hash", "type", "error", "error_description"]) {
          clean.searchParams.delete(key);
        }
        clean.hash = "";
        window.history.replaceState(null, "", clean.toString());
      } catch {
        // URL cleanup is best effort; the outcome below is what matters.
      }
      setOutcome(result);
      if (result.status === "done") {
        nav({ to: result.next });
      }
    });
  }, [nav, search]);

  if (outcome.status === "working") {
    return (
      <AuthLayout title={t("Confirming…")} subtitle={t("Finishing verification.")}>
        <p className="text-sm text-muted-foreground" role="status">
          {t("Checking the link with the server…")}
        </p>
      </AuthLayout>
    );
  }

  if (outcome.status === "done") {
    return (
      <AuthLayout
        title={t("Signed in")}
        subtitle={
          outcome.onboarded === false
            ? t("One more step to finish your account.")
            : t("Taking you back to Unbored…")
        }
      >
        <p className="text-sm text-muted-foreground" role="status">
          {outcome.onboarded === false
            ? t("Finishing your registration…")
            : t("Your account is ready. Redirecting…")}
        </p>
      </AuthLayout>
    );
  }

  if (outcome.status === "confirmed-no-session") {
    return (
      <AuthLayout title={t("Email confirmed")} subtitle={t("Your address is verified.")}>
        <p className="text-sm text-muted-foreground">
          {t("Sign in to continue — no session was issued with this confirmation.")}
        </p>
        <Button asChild variant="play" size="xl" className="mt-6 w-full">
          <Link to="/login">{t("Continue to log in")}</Link>
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title={t("Link didn't work")}
      subtitle={t("That confirmation link could not be used.")}
    >
      <p className="text-sm text-destructive" role="alert">
        {outcome.message}
      </p>
      <div className="mt-6 grid gap-2">
        <Button asChild variant="secondary" size="lg" className="w-full">
          <Link to="/verify-email" search={{ email: undefined }}>
            {t("Request a new link")}
          </Link>
        </Button>
        <Button asChild variant="play" size="xl" className="w-full">
          <Link to="/login">{t("Back to log in")}</Link>
        </Button>
      </div>
    </AuthLayout>
  );
}

function parseFragment(hash: string): Record<string, string> {
  const out: Record<string, string> = {};
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  for (const part of raw.split("&")) {
    const [key, ...rest] = part.split("=");
    if (!key) continue;
    out[decodeURIComponent(key)] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function describeOAuthError(code: string, description?: string): string {
  if (code === "access_denied") {
    return t("Google sign-in was cancelled. Try again when you're ready.");
  }
  // Supabase refuses to attach a Google identity to an address that already
  // belongs to an account it cannot safely link. Nothing was created, and the
  // way in is the existing sign-in method — the same answer the registration
  // flow gives for a duplicate email.
  if (
    code === "email_exists" ||
    code === "user_already_exists" ||
    code === "identity_already_exists"
  ) {
    return t("An account with this email already exists. Please sign in instead.");
  }
  return description && description !== ""
    ? description
    : t("That sign-in did not complete. Try again.");
}
