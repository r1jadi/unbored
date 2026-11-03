import { createFileRoute, Link } from "@tanstack/react-router";
import { Brain, Calendar, Check, Gamepad2, Lightbulb, Puzzle, Zap } from "lucide-react";
import { useState } from "react";
import { AuthLayout } from "@/components/auth/AuthLayout";
import { GameArt } from "@/components/game/GameArt";
import { Button } from "@/components/ui/button";
import { seo } from "@/lib/seo";
import { cn } from "@/lib/utils";

import { t, msg } from "@/lib/settings/language";
export const Route = createFileRoute("/onboarding")({
  head: () => seo(t("Get started"), t("Tell us what you like to play.")),
  component: Onboarding,
});

const steps = [
  {
    title: msg("Swipe to discover"),
    body: msg("Every card in your feed is a game you can play instantly."),
    art: "dont-touch-the-black" as const,
  },
  {
    title: msg("Play in seconds"),
    body: msg("No downloads, no tutorials. Tap play and go."),
    art: "stack-10" as const,
  },
  {
    title: msg("Beat your friends"),
    body: msg("Every run lands on a leaderboard. Follow people to compete."),
    art: "memory-flash" as const,
  },
];
const interests = [
  { id: "puzzle", label: msg("Puzzle"), icon: Puzzle },
  { id: "arcade", label: msg("Arcade"), icon: Gamepad2 },
  { id: "logic", label: msg("Logic"), icon: Lightbulb },
  { id: "reaction", label: msg("Reaction"), icon: Zap },
  { id: "memory", label: msg("Memory"), icon: Brain },
  { id: "daily", label: msg("Daily challenges"), icon: Calendar },
];

function Onboarding() {
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const last = step === steps.length;

  return (
    <AuthLayout
      title={last ? t("What do you like to play?") : t(steps[step].title)}
      subtitle={last ? t("Pick at least two. You can change this later.") : t(steps[step].body)}
      back={step > 0}
    >
      {!last ? (
        <GameArt
          key={step}
          id={steps[step].art}
          className="enter aspect-square w-full rounded-2xl border border-glass-border"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={t("Interests")}>
          {interests.map(({ id, label, icon: Icon }) => {
            const on = picked.includes(id);
            return (
              <button
                key={id}
                aria-pressed={on}
                onClick={() => setPicked(on ? picked.filter((p) => p !== id) : [...picked, id])}
                className={cn(
                  "press relative flex flex-col items-start gap-6 rounded-xl border p-4 text-left text-sm font-medium",
                  on ? "border-primary bg-primary/10" : "border-border bg-surface",
                )}
              >
                <Icon className="size-5" strokeWidth={1.75} />
                {t(label)}
                {on && <Check className="absolute top-3 right-3 size-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-auto pt-8">
        <div className="mb-5 flex justify-center gap-1.5" aria-hidden>
          {[...steps, 0].map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 rounded-full transition-all duration-200",
                i === step ? "w-6 bg-foreground" : "w-1.5 bg-surface-2",
              )}
            />
          ))}
        </div>
        {last ? (
          <Button asChild variant="play" size="xl" className="w-full" disabled={picked.length < 2}>
            <Link
              to="/signup"
              disabled={picked.length < 2}
              aria-disabled={picked.length < 2}
              className={cn(picked.length < 2 && "pointer-events-none opacity-50")}
            >
              {t("Continue")}
            </Link>
          </Button>
        ) : (
          <Button variant="play" size="xl" className="w-full" onClick={() => setStep(step + 1)}>
            {t("Continue")}
          </Button>
        )}
        {!last && (
          <button
            className="mt-2 w-full py-2 text-sm text-muted-foreground"
            onClick={() => setStep(steps.length)}
          >
            {t("Skip")}
          </button>
        )}
      </div>
    </AuthLayout>
  );
}
