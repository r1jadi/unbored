import { useEffect } from "react";
import { toast } from "sonner";

import { useAuth } from "@/lib/auth/session";
import { titleFromSlug } from "@/lib/games/catalog";
import { claimHeldGuestRun, type ClaimOutcome } from "@/lib/games/guest-claim";
import { t } from "@/lib/settings/language";

/**
 * Saves the guest run a player asked to keep, as soon as they have a finished
 * account: after sign-in, after sign-up's last step, or on the next visit while
 * the run is still claimable. Renders nothing; the answer is a toast.
 */
export function GuestRunClaimer() {
  const auth = useAuth();
  // An account mid-registration has no profile yet: its score would be saved to a
  // player the boards cannot show. The claim waits for the last sign-up step.
  const userId =
    auth.status === "authenticated" && auth.session.onboarded !== false
      ? auth.session.userId
      : undefined;

  useEffect(() => {
    if (!userId) return;
    void claimHeldGuestRun().then((outcome) => {
      if (outcome) announce(outcome);
    });
  }, [userId]);

  return null;
}

function announce(outcome: ClaimOutcome): void {
  switch (outcome.kind) {
    case "saved":
      toast.success(
        t("Your score of {score} in {game} is saved to your account.", {
          score: outcome.run.score.toLocaleString(),
          game: titleFromSlug(outcome.run.gameSlug),
        }),
      );
      return;
    case "already-played":
      toast(
        t("You'd already played today's {game}, so your guest run wasn't added.", {
          game: titleFromSlug(outcome.gameSlug),
        }),
      );
      return;
    case "gone":
      toast(t("That guest run can't be saved any more."));
      return;
    case "later":
      // Kept on the device; the next sign-in or visit tries again.
      return;
  }
}
