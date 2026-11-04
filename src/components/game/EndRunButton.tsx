import { useContext, useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { RunLeaveContext } from "@/lib/games/run-progress";
import { points } from "@/lib/format";

import { t } from "@/lib/settings/language";
/**
 * End run, with a confirmation.
 *
 * Ending a run saves it: the runtime submits the run as it stands and shows the
 * score the server verified. For a signed-in player the run can then be picked up
 * again later. The confirmation is there so a mis-tap next to the board doesn't
 * interrupt the run.
 */
export function EndRunButton({
  score,
  offline = false,
  disabled,
  onEnd,
}: {
  /** The score the run has earned so far, which is the one kept. */
  score: number;
  /** An offline practice run: ending it keeps the score on screen, and sends nothing. */
  offline?: boolean;
  disabled: boolean;
  onEnd: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const leave = useContext(RunLeaveContext);
  const later = leave?.resumable === true;

  return (
    <>
      <div className="flex justify-center pt-1">
        <Button variant="ghost" size="sm" disabled={disabled} onClick={() => setConfirming(true)}>
          {t("End run")}
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("End this run?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {offline
                ? t(
                    "Your score of {score} is kept as practice: offline runs are not verified or saved.",
                    { score: points(score) },
                  )
                : later
                  ? t("Your score of {score} is kept, and you can pick this run up again later.", {
                      score: points(score),
                    })
                  : t("Your score of {score} is kept and sent for verification.", {
                      score: points(score),
                    })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Keep playing")}</AlertDialogCancel>
            <AlertDialogAction onClick={onEnd}>{t("End run")}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
