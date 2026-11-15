import { useContext } from "react";

import { AlertDialogAction } from "@/components/ui/alert-dialog";
import { buttonVariants } from "@/components/ui/button";
import { RunLeaveContext } from "@/lib/games/run-progress";
import { t } from "@/lib/settings/language";

/**
 * Finish later, for a game's own End run dialog.
 *
 * The play screen's quit control already offers it, but the End run button under
 * the board is the one players reach for, and its dialog used to offer only End
 * run — so a run that could be left and continued looked as if it couldn't. This
 * shows exactly when the play screen would: a signed-in player's live run that is
 * saved as it is played. Anywhere else (a guest, an offline run, a callout, a
 * runtime mounted outside the play screen) it renders nothing.
 */
export function FinishLaterAction() {
  const leave = useContext(RunLeaveContext);
  if (!leave?.resumable) return null;
  return (
    <AlertDialogAction className={buttonVariants({ variant: "secondary" })} onClick={leave.leave}>
      {t("Finish later")}
    </AlertDialogAction>
  );
}
