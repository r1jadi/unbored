import { Link, useRouter } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";
import { GameArt } from "@/components/game/GameArt";
import { Logo } from "@/components/layout/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { t } from "@/lib/settings/language";
// Catalogue slugs, drawn as a decorative collage. They are plain strings because
// the artwork component keys on the slug the catalogue serves.
const collage: string[] = ["stack-10", "memory-flash", "color-merge", "dont-break-the-chain"];

export function AuthLayout({
  title,
  subtitle,
  children,
  back = true,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  back?: boolean;
  footer?: ReactNode;
}) {
  const router = useRouter();
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-2">
      <div className="hidden border-r border-border bg-sidebar p-10 lg:flex lg:flex-col">
        <Link to="/" aria-label={t("Unbored home")}>
          <Logo />
        </Link>
        <div className="my-auto grid max-w-md grid-cols-2 gap-3 self-center">
          {collage.map((id) => (
            <GameArt
              key={id}
              id={id}
              className="aspect-square rounded-2xl border border-glass-border"
            />
          ))}
        </div>
        <p className="max-w-sm text-sm text-muted-foreground">
          {t("Short games. Real scores. Stay unbored.")}
        </p>
      </div>
      <div className="flex min-h-dvh flex-col px-5 pt-[calc(1rem+var(--safe-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="flex h-12 items-center">
          {back && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Go back")}
              className="-ml-2"
              onClick={() => router.history.back()}
            >
              <ArrowLeft />
            </Button>
          )}
        </div>
        <div className="enter mx-auto flex w-full max-w-sm flex-1 flex-col pt-4 lg:justify-center lg:pt-0">
          <h1 className="text-2xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1.5 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-8 flex flex-1 flex-col lg:flex-none">{children}</div>
          {footer && <div className="mt-6 text-center text-sm text-muted-foreground">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({
  id,
  label,
  hint,
  description,
  error,
  ...props
}: React.ComponentProps<typeof Input> & {
  id: string;
  label: string;
  /** Something short beside the label, like a link. It shares the label's row. */
  hint?: ReactNode;
  /** A sentence about the field, drawn under the input. */
  description?: string;
  error?: string;
}) {
  const describedBy = [description && `${id}-desc`, error && `${id}-err`].filter(Boolean).join(" ");
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        {hint}
      </div>
      <Input
        id={id}
        aria-invalid={!!error}
        aria-describedby={describedBy || undefined}
        className="h-12 rounded-lg bg-surface text-base md:text-sm"
        {...props}
      />
      {description && (
        <p id={`${id}-desc`} className="text-xs text-muted-foreground">
          {description}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SocialButtons({
  next,
  divider = t("or with email"),
}: { next?: string; divider?: string } = {}) {
  return (
    <>
      <div className="grid gap-2">
        <Button
          variant="secondary"
          size="lg"
          type="button"
          onClick={() => {
            // Real Supabase Google OAuth (PKCE). Failures surface on the
            // callback screen, never as a simulated success.
            void import("@/lib/auth/session").then(async ({ googleAuthorizeUrl }) => {
              window.location.href = await googleAuthorizeUrl(next ?? "/");
            });
          }}
        >
          {t("Continue with Google")}
        </Button>
      </div>
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        {divider}
        <span className="h-px flex-1 bg-border" />
      </div>
    </>
  );
}
