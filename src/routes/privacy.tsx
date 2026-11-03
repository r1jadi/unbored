import { createFileRoute } from "@tanstack/react-router";
import { Page, PageHeader } from "@/components/common";
import { LegalBody, privacy } from "@/components/legal";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/privacy")({
  head: () => seo(t("Privacy Policy"), t("How Unbored collects, uses and protects your data.")),
  component: () => (
    <Page>
      <PageHeader back title={t("Privacy Policy")} />
      <div className="px-4 md:px-0">
        <LegalBody sections={privacy} />
      </div>
    </Page>
  ),
});
