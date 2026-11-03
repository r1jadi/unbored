import { createFileRoute, Link } from "@tanstack/react-router";
import { Check } from "lucide-react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/account-created")({
  head: () => seo(t("You're in"), t("Your Unbored account is ready.")),
  component: () => (
    <AuthLayout
      title={t("You're in")}
      subtitle={t("Your account is ready. Your first game is waiting.")}
      back={false}
    >
      <div className="flex justify-center py-10">
        <span className="flex size-20 items-center justify-center rounded-full bg-success/15">
          <Check className="size-9 text-success" />
        </span>
      </div>
      <div className="mt-auto space-y-2 lg:mt-4">
        <Button asChild variant="play" size="xl" className="w-full">
          <Link to="/">{t("Start playing")}</Link>
        </Button>
        <Button asChild variant="ghost" size="lg" className="w-full">
          <Link to="/settings/$section" params={{ section: "profile" }}>
            {t("Set up your profile")}
          </Link>
        </Button>
      </div>
    </AuthLayout>
  ),
});
