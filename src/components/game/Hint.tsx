import { Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";

/** The Hint button: shown only once a hint is on offer, counting down between hints. */
export function HintButton({
  offered,
  waitSeconds,
  onAsk,
}: {
  offered: boolean;
  waitSeconds: number;
  onAsk: () => void;
}) {
  if (!offered) return null;
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onAsk}
      disabled={waitSeconds > 0}
      className="enter tabular"
    >
      <Lightbulb />
      {waitSeconds > 0 ? `Next hint in ${waitSeconds}s` : "Hint"}
    </Button>
  );
}
