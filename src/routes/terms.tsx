import { createFileRoute } from "@tanstack/react-router";
import { Page, PageHeader } from "@/components/common";
import { LegalBody, terms } from "@/components/legal";
import { seo } from "@/lib/seo";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/terms")({
  head: () => seo(t("Terms & Conditions"), t("The rules for using Unbored.")),
  component: () => (
    <Page>
      <PageHeader back title={t("Terms & Conditions")} />
      <div className="px-4 md:px-0">
        <LegalBody sections={terms} />
      </div>
    </Page>
  ),
});
