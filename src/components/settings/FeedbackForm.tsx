import { Link } from "@tanstack/react-router";
import { Bug, Heart, Lightbulb, MessageCircle, Send, type LucideIcon } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError } from "@/lib/api/client";
import { useAuth } from "@/lib/auth/session";
import {
  MAX_FEEDBACK_LENGTH,
  MIN_FEEDBACK_LENGTH,
  sendFeedback,
  type FeedbackCategory,
} from "@/lib/feedback";
import { cn } from "@/lib/utils";

import { t, msg } from "@/lib/settings/language";
const MOODS = [
  { value: 1, emoji: "😣", label: msg("Rough") },
  { value: 2, emoji: "😕", label: msg("Meh") },
  { value: 3, emoji: "😐", label: msg("Okay") },
  { value: 4, emoji: "🙂", label: msg("Good") },
  { value: 5, emoji: "🤩", label: msg("Love it") },
] as const;

const CATEGORIES: {
  value: FeedbackCategory;
  label: string;
  icon: LucideIcon;
  prompt: string;
}[] = [
  {
    value: "idea",
    label: msg("Idea"),
    icon: Lightbulb,
    prompt: msg("What should we build or change? Dream big, we read everything."),
  },
  {
    value: "bug",
    label: msg("Something broke"),
    icon: Bug,
    prompt: msg("What happened, and what did you expect instead? Which game or page?"),
  },
  {
    value: "praise",
    label: msg("Kind words"),
    icon: Heart,
    prompt: msg("What made you smile? Tell us what's working so we keep it."),
  },
  {
    value: "other",
    label: msg("Something else"),
    icon: MessageCircle,
    prompt: msg("Anything on your mind about Unbored."),
  },
];

/**
 * The feedback page. Unbored changes almost daily, so this is built to be quick:
 * a mood, a kind of note, a few words. Sending writes one row to
 * `public.feedback` as the signed-in player; guests are asked to sign in so
 * the form cannot be used to flood the table.
 */
export function FeedbackForm({ initialCategory = "idea" }: { initialCategory?: FeedbackCategory }) {
  const auth = useAuth();
  const [mood, setMood] = useState<number | null>(null);
  const [category, setCategory] = useState<FeedbackCategory>(initialCategory);
  const [message, setMessage] = useState("");
  const [includeDevice, setIncludeDevice] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const [sent, setSent] = useState<number | null>(null);

  if (auth.status !== "authenticated") {
    return (
      <div className="px-4 md:px-0">
        <EmptyState
          title={t("Sign in to send feedback")}
          body={t("Unbored is new and changing fast. Log in and tell us what to fix, add or keep.")}
          action={
            <Button asChild>
              <Link to="/login" search={{ redirect: "/settings/feedback" }}>
                {t("Log in")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  if (sent !== null) {
    const reaction = MOODS.find((m) => m.value === sent);
    return (
      <div className="flex flex-col items-center px-6 py-12 text-center" role="status">
        <div className="text-6xl motion-safe:animate-bounce" aria-hidden>
          {reaction?.emoji ?? "💌"}
        </div>
        <h2 className="mt-4 text-lg font-semibold">{t("Thank you!")}</h2>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          {t(
            "Your note landed with the team. We read every one, and the next update might just have your fingerprints on it.",
          )}
        </p>
        <Button
          variant="secondary"
          className="mt-6"
          onClick={() => {
            setSent(null);
            setMood(null);
            setMessage("");
          }}
        >
          {t("Send another")}
        </Button>
      </div>
    );
  }

  const active = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0]!;
  const canSend = mood !== null && message.trim().length >= MIN_FEEDBACK_LENGTH && !sending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mood === null || sending) return;
    setSending(true);
    setError(undefined);
    try {
      await sendFeedback({ mood, category, message, includeDevice });
      setSent(mood);
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : t("Couldn't send your feedback. Try again."),
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <form className="space-y-6 px-4 md:px-0" onSubmit={(e) => void submit(e)}>
      <div className="rounded-xl bg-gradient-to-br from-primary/15 via-surface to-surface p-4">
        <p className="text-sm font-medium">{t("Help shape Unbored")}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "We're new and we ship changes almost every day. What you tell us here decides what comes next.",
          )}
        </p>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">{t("How is Unbored feeling?")}</legend>
        <div className="mt-3 grid grid-cols-5 gap-2" role="radiogroup" aria-label={t("Your mood")}>
          {MOODS.map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mood === m.value}
              aria-label={t(m.label)}
              onClick={() => setMood(m.value)}
              className={cn(
                "press flex flex-col items-center gap-1 rounded-xl bg-surface py-3 text-2xl transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mood === m.value
                  ? "scale-105 bg-surface-2 ring-2 ring-primary"
                  : mood !== null && "opacity-60",
              )}
            >
              <span aria-hidden>{m.emoji}</span>
              <span className="text-[11px] text-muted-foreground">{t(m.label)}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="text-sm font-medium">{t("What kind of note is it?")}</legend>
        <div
          className="mt-3 flex flex-wrap gap-2"
          role="radiogroup"
          aria-label={t("Kind of feedback")}
        >
          {CATEGORIES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={category === value}
              onClick={() => setCategory(value)}
              className={cn(
                "press inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                category === value
                  ? "bg-foreground font-medium text-background"
                  : "bg-surface text-muted-foreground",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div>
        <Label htmlFor="feedback-message" className="text-sm font-medium">
          {t("Your note")}
        </Label>
        <textarea
          id="feedback-message"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder={t(active.prompt)}
          rows={6}
          maxLength={MAX_FEEDBACK_LENGTH}
          aria-describedby={error ? "feedback-error" : undefined}
          className="mt-2 w-full resize-y rounded-xl bg-surface p-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">
          {message.length}/{MAX_FEEDBACK_LENGTH}
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-xl bg-surface p-3">
        <div>
          <Label htmlFor="feedback-device" className="text-sm">
            {t("Include my device details")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("Screen size and browser, to help us reproduce bugs.")}
          </p>
        </div>
        <Switch id="feedback-device" checked={includeDevice} onCheckedChange={setIncludeDevice} />
      </div>

      {error && (
        <p id="feedback-error" role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" className="w-full md:w-auto" disabled={!canSend}>
        <Send />
        {sending ? t("Sending…") : t("Send feedback")}
      </Button>
      {mood === null && (
        <p className="-mt-3 text-xs text-muted-foreground">{t("Pick a mood to send.")}</p>
      )}
    </form>
  );
}
