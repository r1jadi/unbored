import { useState } from "react";

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

/**
 * End run, with a confirmation.
 *
 * Ending a run saves it: the runtime submits the run as it stands and shows the
 * score the server verified. The confirmation is there because it also ends the
 * run for good, and a mis-tap next to the board should not.
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
              {`Your score of ${score} is kept and sent for verification.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep playing</AlertDialogCancel>
            <AlertDialogAction onClick={onEnd}>End run</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
