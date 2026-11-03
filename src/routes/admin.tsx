import { createFileRoute } from "@tanstack/react-router";
import { AdminShell } from "@/components/admin/AdminShell";

import { t } from "@/lib/settings/language";
export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: t("Admin — Unbored") },
      { name: "description", content: t("Unbored moderation and operations dashboard.") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => <AdminShell />,
});
