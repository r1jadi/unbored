import { createFileRoute } from "@tanstack/react-router";
import { Bot, Check, Loader2, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AdminListStates,
  AdminPage,
  AdminTable,
  FilterSelect,
  MobileRow,
  OffsetPager,
  SearchField,
  SectionCard,
  StatusBadge,
  Toolbar,
  useDebounced,
  type BadgeTone,
  type Column,
} from "@/components/admin/ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ADMIN_LIMIT, asApiError, formatAgo } from "@/lib/admin/api";
import {
  ruleDeepCut,
  setDeepCutTier,
  useDeepCutAnswers,
  useDeepCutReviews,
  type AdminDeepCutAnswer,
  type AdminDeepCutReview,
  type DeepCutTier,
  type DeepCutVerdict,
} from "@/lib/admin/deep-cut";
import { TIERS } from "@/lib/games/deep-cut";
import { msg, t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/deep-cut")({
  head: () => ({
    meta: [
      { title: t("Deep Cut answers — Unbored admin") },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: DeepCutAdmin,
});

const verdictOptions = [
  { value: "pending", label: msg("Waiting for a ruling") },
  { value: "accepted", label: msg("Accepted") },
  { value: "rejected", label: msg("Rejected") },
  { value: "all", label: msg("Everything") },
];

const verdictTone: Record<DeepCutVerdict, BadgeTone> = {
  pending: "warning",
  accepted: "success",
  rejected: "destructive",
};

const verdictLabel: Record<DeepCutVerdict, string> = {
  pending: msg("pending"),
  accepted: msg("accepted"),
  rejected: msg("rejected"),
};

function tierName(tier: number | null | undefined): string {
  const info = TIERS.find((entry) => entry.tier === tier);
  return info ? `${tier} · ${t(info.name)} (${info.points})` : "—";
}

function TierSelect({
  value,
  onChange,
  label,
  disabled,
}: {
  value: DeepCutTier;
  onChange: (tier: DeepCutTier) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(Number(event.target.value) as DeepCutTier)}
      className="h-9 rounded-lg bg-surface px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
    >
      {TIERS.map((info) => (
        <option key={info.tier} value={info.tier}>
          {tierName(info.tier)}
        </option>
      ))}
    </select>
  );
}

function Verdict({ review }: { review: AdminDeepCutReview }) {
  return (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={verdictTone[review.verdict]}>
        {review.reviewer === "ai" ? (
          <Bot className="size-3" aria-label={t("by the AI judge")} />
        ) : review.reviewer === "staff" ? (
          <ShieldCheck className="size-3" aria-label={t("by staff")} />
        ) : null}
        {t(verdictLabel[review.verdict])}
      </StatusBadge>
      {review.verdict === "accepted" && review.answerName && (
        <span className="text-xs text-muted-foreground">
          {t("as {answer}", { answer: review.answerName })} · {tierName(review.answerTier)}
        </span>
      )}
    </span>
  );
}

/**
 * Deep Cut's review queue: answers the curated bank did not know.
 *
 * The AI judge rules on most of them the moment they're typed; what it couldn't
 * rule on (it was busy, down, or not configured) waits here, most-typed first,
 * because each of those cost a player a score. Staff can also overturn the
 * judge, and move any answer to a better tier — a tier set here survives the
 * next bank load.
 */
export function DeepCutAdmin() {
  const [verdict, setVerdict] = useState<DeepCutVerdict | "all">("pending");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<AdminDeepCutReview | null>(null);
  const term = useDebounced(q.trim());

  const reviews = useDeepCutReviews({
    verdict,
    q: term || undefined,
    limit: ADMIN_LIMIT,
    offset: page * ADMIN_LIMIT,
  });
  const rows = reviews.status === "ready" ? reviews.data.items : [];
  const hasMore = reviews.status === "ready" ? reviews.data.hasMore : false;

  const columns: Column<AdminDeepCutReview>[] = [
    {
      key: "answer",
      head: t("Typed"),
      className: "min-w-40",
      cell: (r) => <span className="text-sm font-medium break-words">{r.sample}</span>,
    },
    {
      key: "question",
      head: t("Question"),
      className: "min-w-64",
      cell: (r) => (
        <span className="min-w-0">
          <span className="block text-sm">{r.prompt}</span>
          <span className="block text-xs text-muted-foreground">{t(r.category)}</span>
        </span>
      ),
    },
    {
      key: "seen",
      head: t("Typed by"),
      cell: (r) => (
        <span className="text-sm tabular-nums">
          {r.seen === 1 ? t("1 player") : t("{n} players", { n: r.seen })}
        </span>
      ),
    },
    { key: "verdict", head: t("Ruling"), cell: (r) => <Verdict review={r} /> },
    {
      key: "when",
      head: t("When"),
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {formatAgo(r.reviewedAt ?? r.firstSeen) ?? "—"}
        </span>
      ),
    },
    {
      key: "action",
      head: <span className="sr-only">{t("Rule")}</span>,
      cell: (r) => (
        <Button
          size="sm"
          variant={r.verdict === "pending" ? "default" : "outline"}
          onClick={() => setOpen(r)}
        >
          {r.verdict === "pending" ? t("Rule") : t("Change")}
        </Button>
      ),
    },
  ];

  return (
    <AdminPage
      title={t("Deep Cut answers")}
      subtitle={t(
        "Answers the bank didn't know. The AI judge rules on most as they're typed; the rest wait here, most-typed first. You can also move any answer to another tier.",
      )}
    >
      <Toolbar>
        <SearchField
          value={q}
          onChange={(value) => {
            setQ(value);
            setPage(0);
          }}
          label={t("Search answers")}
          placeholder={t("Search answers or questions")}
        />
        <FilterSelect
          label={t("Ruling")}
          value={verdict}
          onChange={(value) => {
            setVerdict(value as DeepCutVerdict | "all");
            setPage(0);
          }}
          options={verdictOptions}
        />
      </Toolbar>

      {reviews.status === "error" ? (
        <SectionCard>
          <AdminListStates
            state="error"
            onRetry={reviews.retry}
            emptyTitle=""
            errorBody={reviews.error.message}
          />
        </SectionCard>
      ) : reviews.status === "loading" ? (
        <AdminListStates state="loading" emptyTitle="" rows={8} />
      ) : rows.length === 0 ? (
        <SectionCard>
          <AdminListStates
            state="ready"
            emptyTitle={
              term
                ? t("Nothing matches that")
                : verdict === "pending"
                  ? t("Nothing waiting")
                  : t("No answers here yet")
            }
            emptyBody={
              term
                ? t("Try a different search.")
                : verdict === "pending"
                  ? t("Every answer players typed has a ruling.")
                  : t("Rulings show up here as players type answers the bank didn't know.")
            }
          />
        </SectionCard>
      ) : (
        <>
          <AdminTable
            columns={columns}
            rows={rows}
            rowKey={(r) => `${r.questionId}:${r.key}`}
            mobileRow={(r) => (
              <MobileRow>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium break-words">{r.sample}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.prompt} · {r.seen === 1 ? t("1 player") : t("{n} players", { n: r.seen })}
                  </span>
                  <span className="mt-1 block">
                    <Verdict review={r} />
                  </span>
                </span>
                <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                  {r.verdict === "pending" ? t("Rule") : t("Change")}
                </Button>
              </MobileRow>
            )}
          />
          <OffsetPager
            page={page}
            setPage={setPage}
            perPage={ADMIN_LIMIT}
            rows={rows.length}
            hasMore={hasMore}
            label="answers"
          />
        </>
      )}

      <RulingDialog
        review={open}
        onClose={() => setOpen(null)}
        onRuled={() => {
          setOpen(null);
          reviews.retry();
        }}
      />
    </AdminPage>
  );
}

type Choice = "existing" | "new" | "reject";

/** One spelling's ruling, beside the question's answers and their tiers. */
function RulingDialog({
  review,
  onClose,
  onRuled,
}: {
  review: AdminDeepCutReview | null;
  onClose: () => void;
  onRuled: () => void;
}) {
  const [version, setVersion] = useState(0);
  const answers = useDeepCutAnswers(review?.questionId ?? null, version);
  const list = answers.status === "ready" ? answers.data : [];

  const [choice, setChoice] = useState<Choice>("new");
  const [existing, setExisting] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState<DeepCutTier>(4);
  const [saving, setSaving] = useState(false);
  const [retiering, setRetiering] = useState<number | null>(null);

  // A fresh form for each spelling: accepted ones start filed where they are.
  useEffect(() => {
    if (!review) return;
    setChoice(review.verdict === "accepted" && review.answerId ? "existing" : "new");
    setExisting(review.answerId);
    setName(review.sample);
    setTier(review.answerTier ?? 4);
  }, [review]);

  const chosen = list.find((answer) => answer.id === existing) ?? null;
  const canSave =
    !saving &&
    (choice === "reject" ||
      (choice === "existing" && chosen !== null) ||
      (choice === "new" && name.trim().length > 0 && name.trim().length <= 60));

  const save = () => {
    if (!review || !canSave) return;
    setSaving(true);
    const ruling =
      choice === "reject"
        ? ({ verdict: "rejected" } as const)
        : choice === "existing" && chosen
          ? ({ verdict: "accepted", canonical: chosen.canonical, tier: chosen.tier } as const)
          : ({ verdict: "accepted", canonical: name.trim(), tier } as const);
    ruleDeepCut(review.questionId, review.key, ruling)
      .then((result) => {
        toast.success(
          result.verdict === "accepted"
            ? t("“{answer}” now counts.", { answer: review.sample })
            : t("“{answer}” won't count.", { answer: review.sample }),
        );
        onRuled();
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setSaving(false));
  };

  const retier = (answer: AdminDeepCutAnswer, next: DeepCutTier) => {
    setRetiering(answer.id);
    setDeepCutTier(answer.id, next)
      .then(() => {
        toast.success(
          t("{answer} moved to {tier}.", { answer: answer.canonical, tier: tierName(next) }),
        );
        setVersion((n) => n + 1);
      })
      .catch((error: unknown) => toast.error(asApiError(error).message))
      .finally(() => setRetiering(null));
  };

  return (
    <Dialog open={review !== null} onOpenChange={(next) => (next ? null : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        {review && (
          <>
            <DialogHeader>
              <DialogTitle>{t("Does “{answer}” count?", { answer: review.sample })}</DialogTitle>
              <DialogDescription>{review.prompt}</DialogDescription>
            </DialogHeader>

            <fieldset className="space-y-3">
              <legend className="sr-only">{t("Ruling")}</legend>
              <Option
                checked={choice === "existing"}
                onSelect={() => setChoice("existing")}
                icon={<Check className="size-4" aria-hidden />}
                title={t("Yes: it's another name for an answer we have")}
              >
                <select
                  aria-label={t("Which answer")}
                  value={existing ?? ""}
                  onFocus={() => setChoice("existing")}
                  onChange={(event) => {
                    setChoice("existing");
                    setExisting(event.target.value ? Number(event.target.value) : null);
                  }}
                  className="h-9 w-full rounded-lg bg-surface px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <option value="">{t("Choose an answer…")}</option>
                  {list.map((answer) => (
                    <option key={answer.id} value={answer.id}>
                      {answer.canonical} — {tierName(answer.tier)}
                    </option>
                  ))}
                </select>
              </Option>
              <Option
                checked={choice === "new"}
                onSelect={() => setChoice("new")}
                icon={<Check className="size-4" aria-hidden />}
                title={t("Yes: it's a new answer")}
              >
                <div className="flex flex-wrap gap-2">
                  <input
                    aria-label={t("The answer's name")}
                    value={name}
                    maxLength={60}
                    onFocus={() => setChoice("new")}
                    onChange={(event) => setName(event.target.value)}
                    className="h-9 min-w-0 flex-1 rounded-lg bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <TierSelect
                    label={t("Its tier")}
                    value={tier}
                    onChange={(next) => {
                      setChoice("new");
                      setTier(next);
                    }}
                  />
                </div>
              </Option>
              <Option
                checked={choice === "reject"}
                onSelect={() => setChoice("reject")}
                icon={<X className="size-4" aria-hidden />}
                title={t("No: it isn't a correct answer")}
              />
            </fieldset>

            <section className="space-y-2">
              <h3 className="text-sm font-semibold">{t("This question's answers")}</h3>
              <p className="text-xs text-muted-foreground">
                {t(
                  "Tiers are estimates of how often people give an answer. Once a question has 100 answers, each one shows its real share and the tier that suggests. Turns already played keep their points.",
                )}
              </p>
              {answers.status === "loading" ? (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> {t("Loading answers…")}
                </p>
              ) : answers.status === "error" ? (
                <p className="text-sm text-destructive">{answers.error.message}</p>
              ) : (
                <ul className="max-h-72 divide-y overflow-y-auto rounded-xl border">
                  {list.map((answer) => (
                    <li key={answer.id} className="flex items-center gap-3 px-3 py-2">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{answer.canonical}</span>
                        <span className="block text-xs text-muted-foreground">
                          {answer.given === 1
                            ? t("given once")
                            : t("given {n} times", { n: answer.given })}
                          {answer.sharePercent !== null &&
                            ` · ${t("{n}% of answers", { n: answer.sharePercent })}`}
                          {answer.source !== "curated" &&
                            ` · ${answer.source === "ai" ? t("added by the AI judge") : t("set by staff")}`}
                        </span>
                      </span>
                      {answer.suggestedTier !== null && answer.suggestedTier !== answer.tier && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="shrink-0 text-xs"
                          disabled={retiering !== null}
                          title={t("What players actually say suggests this tier")}
                          onClick={() => retier(answer, answer.suggestedTier!)}
                        >
                          {t("Play says {tier}", { tier: answer.suggestedTier })}
                        </Button>
                      )}
                      <TierSelect
                        label={t("Tier for {answer}", { answer: answer.canonical })}
                        value={answer.tier}
                        disabled={retiering !== null}
                        onChange={(next) => next !== answer.tier && retier(answer, next)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <DialogFooter>
              <Button variant="outline" onClick={onClose}>
                {t("Cancel")}
              </Button>
              <Button
                onClick={save}
                disabled={!canSave}
                variant={choice === "reject" ? "destructive" : "default"}
              >
                {saving && <Loader2 className="animate-spin" />}
                {choice === "reject" ? t("Reject it") : t("Accept it")}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Option({
  checked,
  onSelect,
  icon,
  title,
  children,
}: {
  checked: boolean;
  onSelect: () => void;
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "space-y-2 rounded-xl border p-3 transition-colors",
        checked ? "border-primary bg-primary/5" : "border-border",
      )}
    >
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium">
        <input type="radio" name="deep-cut-ruling" checked={checked} onChange={onSelect} />
        {icon}
        {title}
      </label>
      {children}
    </div>
  );
}
