import { useId, useState } from "react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/settings/language";

/**
 * Staff only: take a reported profile picture down, with a reason. The server
 * re-checks that the caller is staff and logs the action against their name; this
 * dialog is only shown to staff so they don't have to leave the profile to do it.
 */
export function RemovePhotoDialog({
  open,
  onOpenChange,
  userId,
  username,
  onRemoved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  username: string;
  onRemoved?: () => void;
}) {
  const id = useId();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      const { removeAvatar } = await import("@/lib/admin/api");
      await removeAvatar(userId, reason.trim());
      toast.success(t("Removed @{username}'s photo.", { username }));
      setReason("");
      onOpenChange(false);
      onRemoved?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("Couldn't remove the photo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) setReason("");
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Remove this photo")}</DialogTitle>
          <DialogDescription>
            {t(
              "@{username}'s picture is taken off their profile everywhere. The reason is recorded against your name.",
              { username },
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor={id}>{t("Reason")}</Label>
          <Textarea
            id={id}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            className="bg-surface"
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t("Cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy || reason.trim() === ""}
            onClick={() => void confirm()}
          >
            {t("Remove photo")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
