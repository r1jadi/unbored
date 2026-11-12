import { createFileRoute, Link } from "@tanstack/react-router";

import { Page, PageHeader } from "@/components/common";
import { OPERATOR } from "@/components/legal";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth/session";
import { seo } from "@/lib/seo";
import { t } from "@/lib/settings/language";

/**
 * How to delete an Unbored account, public. Google Play asks for a deletion URL that
 * works without the app; Apple asks that deletion be easy to find. The deletion
 * itself happens in Settings (`public.delete_my_account`), which this page leads to.
 */
export const Route = createFileRoute("/delete-account")({
  head: () =>
    seo(
      t("Delete your account"),
      t("How to delete your Unbored account and everything tied to it."),
    ),
  component: DeleteAccount,
});

function DeleteAccount() {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  return (
    <Page>
      <PageHeader back title={t("Delete your account")} />
      <div className="space-y-6 px-4 pb-10 text-sm md:px-0">
        <section className="rounded-xl bg-surface p-5">
          <h2 className="text-base font-semibold">{t("In the app or on the web")}</h2>
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-muted-foreground">
            <li>{t("Log in to Unbored.")}</li>
            <li>{t("Open Settings.")}</li>
            <li>{t("Tap Delete account at the bottom, then confirm.")}</li>
          </ol>
          <Button asChild size="lg" className="mt-4 w-full md:w-auto">
            {signedIn ? (
              <Link to="/settings">{t("Go to Settings")}</Link>
            ) : (
              <Link to="/login" search={{ redirect: "/settings" }}>
                {t("Log in to delete your account")}
              </Link>
            )}
          </Button>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">{t("What is deleted")}</h2>
          <p className="text-muted-foreground">
            {t(
              "Deletion is immediate and permanent and cannot be undone. It removes your profile and picture, preferences, scores and leaderboard entries, comments, likes, saves, follows, blocks, every chat you were part of, reports you filed, push subscriptions, signed-in devices and notifications.",
            )}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">{t("What stays for a while")}</h2>
          <p className="text-muted-foreground">
            {t(
              "Encrypted database backups held by our provider expire within 30 days. If you accepted analytics, past analytics events stay under an account id that no longer belongs to anyone; email us to have them erased too.",
            )}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-base font-semibold">{t("Can't log in?")}</h2>
          <p className="text-muted-foreground">
            {t(
              "Email {email} from the address on your account and ask us to delete it. We delete it within 30 days and confirm by email.",
              { email: OPERATOR.email },
            )}
          </p>
          <Button asChild variant="secondary" size="lg" className="w-full md:w-auto">
            <a
              href={`mailto:${OPERATOR.email}?subject=${encodeURIComponent("Delete my Unbored account")}`}
            >
              {t("Email us")}
            </a>
          </Button>
        </section>
      </div>
    </Page>
  );
}
