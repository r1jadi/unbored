import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, Mail } from "lucide-react";

import { Page, PageHeader } from "@/components/common";
import { OPERATOR } from "@/components/legal";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";
import { SUPPORT_FAQ } from "@/lib/support";

/**
 * Support, public: the page the App Store and Google Play listings link to. It has
 * to work for anyone, signed in or not, so it names a real contact rather than
 * pointing only at the in-app feedback form.
 */
export const Route = createFileRoute("/support")({
  head: () =>
    seo(
      t("Support"),
      t(
        "Get help with Unbored: contact us, answers to common questions, and how to delete your account.",
      ),
    ),
  component: Support,
});

function Support() {
  return (
    <Page>
      <PageHeader back title={t("Support")} />
      <div className="space-y-8 px-4 pb-10 md:px-0">
        <section className="rounded-xl bg-surface p-5">
          <h2 className="text-base font-semibold">{t("Contact us")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Questions about your account, a bug, a player breaking the rules, or your data: email us and a person will answer.",
            )}
          </p>
          <Button asChild size="lg" className="mt-4 w-full md:w-auto">
            <a href={`mailto:${OPERATOR.email}`}>
              <Mail />
              {OPERATOR.email}
            </a>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            {t(
              "Signed in? Settings → Help → Open an issue sends a report straight from the app. To report a player or a comment, use Report where you see them.",
            )}
          </p>
        </section>

        <section>
          <h2 className="px-1 text-base font-semibold">{t("Frequently asked")}</h2>
          <div className="mt-2 divide-y divide-border overflow-hidden rounded-xl bg-surface">
            {SUPPORT_FAQ.map(([q, a]) => (
              <details key={q} className="group px-4 py-3">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm">
                  {t(q)}
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180" />
                </summary>
                <p className="mt-2 text-sm text-muted-foreground">{t(a)}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="space-y-2 text-sm">
          <h2 className="px-1 text-base font-semibold">{t("More")}</h2>
          <ul className="divide-y divide-border overflow-hidden rounded-xl bg-surface">
            {(
              [
                ["/delete-account", t("Delete your account")],
                ["/privacy", t("Privacy Policy")],
                ["/terms", t("Terms & Conditions")],
              ] as const
            ).map(([to, label]) => (
              <li key={to}>
                <Link to={to} className="flex min-h-12 items-center px-4 hover:bg-surface-2">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="px-1 pt-2 text-xs text-muted-foreground">
            {t("Unbored is operated by {name}, {country}.", {
              name: OPERATOR.name,
              country: t("Republic of Kosovo"),
            })}
          </p>
        </section>
      </div>
    </Page>
  );
}
