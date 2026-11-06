import { useId, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/client";
import { t } from "@/lib/settings/language";
import {
  MAX_REPORT_DETAILS,
  REPORT_REASONS,
  submitReport,
  type ReportTarget,
} from "@/lib/social/reports";

/**
 * Asks why, then files the report. A caller that only knows a username passes a
 * function for `targetId`, which resolves the id when the report is sent.
 */
export function ReportDialog({
  open,
  onOpenChange,
  kind,
  targetId,
  subject,
  includeMessages = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kind: ReportTarget;
  targetId: string | (() => Promise<string | null>);
  /** What is being reported, in a phrase: "@nora", "this comment". */
  subject: string;
  /** A report from a chat shares the player's recent messages, and says so here. */
  includeMessages?: boolean;
}) {
  const [reason, setReason] = useState("");
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = useId();

  function close(next: boolean) {
    if (busy) return;
    if (!next) {
      setReason("");
      setDetails("");
      setError(undefined);
    }
    onOpenChange(next);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (reason === "" || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const id = typeof targetId === "function" ? await targetId() : targetId;
      if (!id) {
        throw new ApiError(t("This can't be reported any more. It may have been removed."), {
          code: "not_found",
        });
      }
      await submitReport({ kind, targetId: id, reason, details, includeMessages });
      toast.success(t("Thanks. Moderators will take a look."));
      setReason("");
      setDetails("");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("Couldn't send your report. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-md">
        <form onSubmit={(e) => void submit(e)}>
          <DialogHeader>
            <DialogTitle>{t("Report {subject}", { subject })}</DialogTitle>
            <DialogDescription>
              {t("Moderators review every report. The person you report isn't told who sent it.")}
            </DialogDescription>
          </DialogHeader>
          <fieldset className="mt-4 space-y-1">
            <legend className="mb-2 text-sm font-medium">{t("What's wrong?")}</legend>
            {REPORT_REASONS.map((option) => (
              <label
                key={option}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-surface-2"
              >
                <input
                  type="radio"
                  name={name}
                  value={option}
                  checked={reason === option}
                  onChange={() => setReason(option)}
                  className="size-4 accent-primary"
                />
                {t(option)}
              </label>
            ))}
          </fieldset>
          <label className="mt-3 block space-y-1.5">
            <span className="text-sm font-medium">{t("Anything else? (optional)")}</span>
            <textarea
              value={details}
              maxLength={MAX_REPORT_DETAILS}
              rows={3}
              onChange={(e) => setDetails(e.target.value)}
              className="w-full rounded-lg bg-surface-2 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>
          {includeMessages && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("Their last 5 messages in this chat will be shared with the moderators.")}
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter className="mt-4">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => close(false)}>
              {t("Cancel")}
            </Button>
            <Button type="submit" disabled={busy || reason === ""}>
              {busy ? t("Sending…") : t("Send report")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
