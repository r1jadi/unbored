import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SCORE_SCALE } from "@/lib/format";
import { useGames } from "@/lib/games/catalog";
import { createCallout, createRefusal, type CalloutFormat } from "@/lib/messages/callouts";
import { msg, t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

type Claim = "beat" | "margin" | "target";

const claims: Array<{ value: Claim; label: string }> = [
  { value: "beat", label: msg("I'll beat you") },
  { value: "margin", label: msg("I'll beat you by…") },
  { value: "target", label: msg("I'll score at least…") },
];

const orders: Array<{ value: CalloutFormat; label: string; hint: string }> = [
  {
    value: "sealed",
    label: msg("Sealed scores"),
    hint: msg("You both play blind. Scores show when you've both finished."),
  },
  {
    value: "beat_my_score",
    label: msg("Beat my score"),
    hint: msg("You play now. They see your score, then try to beat it."),
  },
];

/** The daily games are one attempt a day already, so they can't be used for this. */
const DAILY_RUNTIMES = new Set(["crossword", "seven-second", "guesswork"]);

function Choices<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "press rounded-lg border px-3 py-2 text-left text-sm",
            value === option.value ? "border-primary bg-primary/10 font-medium" : "border-border",
          )}
        >
          {t(option.label)}
        </button>
      ))}
    </div>
  );
}

export function CalloutDialog({
  open,
  onOpenChange,
  opponentId,
  username,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  opponentId: string;
  username: string;
  onCreated: () => void;
}) {
  const navigate = useNavigate();
  const games = useGames({ limit: 50 });
  const playable = games.items.filter(
    (game) => game.playable && game.runtime && !DAILY_RUNTIMES.has(game.runtime),
  );
  const [slug, setSlug] = useState("");
  const [claim, setClaim] = useState<Claim>("beat");
  const [amount, setAmount] = useState("");
  const [order, setOrder] = useState<CalloutFormat>("sealed");
  const [stake, setStake] = useState("");
  const [busy, setBusy] = useState(false);

  const gameSlug = slug || playable[0]?.slug || "";
  const number = Number(amount);
  const amountOk = claim === "beat" || (Number.isInteger(number) && number > 0);
  // Players type the score they see, which is the stored one times SCORE_SCALE. Rounding
  // up means a call never ends up easier than what was typed.
  const stored = Math.ceil(number / SCORE_SCALE);

  async function submit() {
    if (!gameSlug || !amountOk || busy) return;
    setBusy(true);
    try {
      const format: CalloutFormat = claim === "target" ? "score_target" : order;
      const result = await createCallout({
        opponentId,
        gameSlug,
        format,
        stake,
        margin: claim === "margin" ? stored : 0,
        target: claim === "target" ? stored : undefined,
      });
      if (result.outcome !== "created" || !result.id) {
        toast.error(createRefusal(result.outcome));
        return;
      }
      onOpenChange(false);
      setAmount("");
      setStake("");
      onCreated();
      // Your friend sees a beat-my-score once there is a score to beat.
      if (format === "beat_my_score") {
        void navigate({
          to: "/play/$id",
          params: { id: gameSlug },
          search: { start: true, challenge: result.id, with: username },
        });
      }
    } catch {
      toast.error(t("That didn't go through. Try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-md gap-4 overflow-y-auto">
        <div>
          <DialogTitle>{t("Call out @{username}", { username })}</DialogTitle>
          <DialogDescription className="mt-1">
            {t("Same board, one attempt each. The loser wears it on their profile for a day.")}
          </DialogDescription>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="callout-game">{t("Game")}</Label>
          <select
            id="callout-game"
            value={gameSlug}
            onChange={(event) => setSlug(event.target.value)}
            className="h-10 rounded-lg border border-input bg-background px-3 text-sm"
          >
            {playable.map((game) => (
              <option key={game.slug} value={game.slug}>
                {game.title}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-1.5">
          <Label>{t("Your call")}</Label>
          <Choices label={t("Your call")} options={claims} value={claim} onChange={setClaim} />
          {claim !== "beat" && (
            <Input
              inputMode="numeric"
              value={amount}
              onChange={(event) => setAmount(event.target.value.replace(/[^0-9]/g, ""))}
              placeholder={claim === "margin" ? t("Points, like 100") : t("Score, like 10000")}
              aria-label={claim === "margin" ? t("Points, like 100") : t("Score, like 10000")}
            />
          )}
          {claim === "target" && (
            <p className="text-xs text-muted-foreground">
              {t("Only you play. Hit it and you win, miss it and they do.")}
            </p>
          )}
        </div>

        {claim !== "target" && (
          <div className="grid gap-1.5">
            <Label>{t("How you play it")}</Label>
            <Choices
              label={t("How you play it")}
              options={orders}
              value={order}
              onChange={setOrder}
            />
            <p className="text-xs text-muted-foreground">
              {t(orders.find((option) => option.value === order)!.hint)}
            </p>
          </div>
        )}

        <div className="grid gap-1.5">
          <Label htmlFor="callout-stake">{t("Loser has to… (optional)")}</Label>
          <Input
            id="callout-stake"
            value={stake}
            maxLength={80}
            onChange={(event) => setStake(event.target.value)}
            placeholder={t("buy coffee")}
          />
        </div>

        <Button disabled={!gameSlug || !amountOk || busy} onClick={() => void submit()}>
          {order === "beat_my_score" && claim !== "target" ? t("Play first") : t("Send callout")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
