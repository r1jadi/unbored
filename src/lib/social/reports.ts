/**
 * Reporting a player, a comment or a game.
 *
 * One way in for every report in the app: `public.submit_report`, which validates
 * the target, treats a repeat of an open report as the same report, and limits how
 * many one player can file in a day. Reports land in the moderators' queue
 * (`/admin/reports`).
 */

import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { msg, t } from "@/lib/settings/language";
import { restMutate, SupabaseRestError } from "@/lib/supabase/rest";

export type ReportTarget = "profile" | "comment" | "game";

/** The reasons offered, stored in English so the queue reads the same for all staff. */
export const REPORT_REASONS = [
  msg("Harassment or bullying"),
  msg("Hate speech"),
  msg("Spam or scams"),
  msg("Sexual or violent content"),
  msg("Impersonation"),
  msg("Cheating"),
  msg("Something else"),
] as const;

export const MAX_REPORT_DETAILS = 500;

export async function submitReport(report: {
  kind: ReportTarget;
  targetId: string;
  reason: string;
  details?: string;
  /** From a chat: lets moderators read this player's last few messages in it. */
  includeMessages?: boolean;
}): Promise<void> {
  const token = getAccessToken();
  if (!token) {
    throw new ApiError(t("Log in to send a report."), { code: "unauthorized", status: 401 });
  }
  try {
    await restMutate("rpc/submit_report", "POST", token, {
      p_target_kind: report.kind,
      p_target_id: report.targetId,
      p_reason: report.reason,
      p_details: report.details?.trim() || null,
      p_include_messages: report.includeMessages === true,
    });
  } catch (error) {
    if (error instanceof SupabaseRestError && error.code === "53400") {
      throw new ApiError(t("You've sent a lot of reports today. Try again tomorrow."), {
        code: "rate_limited",
        status: 429,
      });
    }
    if (error instanceof SupabaseRestError && error.code === "P0002") {
      throw new ApiError(t("This can't be reported any more. It may have been removed."), {
        code: "not_found",
        status: 404,
      });
    }
    throw new ApiError(t("Couldn't send your report. Try again."), { code: "report_failed" });
  }
}
