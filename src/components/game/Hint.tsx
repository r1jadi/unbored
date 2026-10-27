import { Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Why the hinted move is right, in a sentence. Shown in place of a game's status
 * line while a hint is up, and announced like it.
 */
export function HintNote({ reason, className }: { reason: string; className?: string }) {
  return (
    <p
      className={cn(
        "enter mx-auto flex max-w-md items-start gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-left text-sm text-foreground",
        className,
      )}
      aria-live="polite"
    >
      <Lightbulb className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <span>
        <span className="sr-only">Hint: </span>
        {reason}
      </span>
    </p>
  );
}

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
