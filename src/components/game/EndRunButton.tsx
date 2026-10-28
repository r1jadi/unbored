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
import { Button, buttonVariants } from "@/components/ui/button";
import { RunLeaveContext } from "@/lib/games/run-progress";

/**
 * End run, with a confirmation.
 *
 * Ending a run saves it: the runtime submits the run as it stands and shows the
 * score the server verified. The confirmation is there because it also ends the
 * run for good, and a mis-tap next to the board should not. A run that is saved
 * as it is played can instead be left to finish later, from the same dialog.
 */
export function EndRunButton({
  score,
  disabled,
  onEnd,
}: {
  /** The score the run has earned so far, which is the one kept. */
  score: number;
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
          End run
        </Button>
      </div>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>End this run?</AlertDialogTitle>
            <AlertDialogDescription>
              {later
                ? `Finish later and the run is waiting for you next time — or end it now and your score of ${score} is kept and sent for verification.`
                : `Your score of ${score} is kept and sent for verification.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            {later && (
              <AlertDialogAction
                className={buttonVariants({ variant: "secondary" })}
                onClick={leave.leave}
              >
                Finish later
              </AlertDialogAction>
            )}
            <AlertDialogAction onClick={onEnd}>End run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
