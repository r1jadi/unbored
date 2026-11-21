import {
  Check,
  FileText,
  Fingerprint,
  FolderClosed,
  Gavel,
  Image as ImageIcon,
  MessageSquare,
  Receipt,
  ScrollText,
  StickyNote,
  X,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { DailyFrame, DailyResult, EndRunButton, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import type { CardKind, Suspect } from "@/lib/games/alibi-bank";
import {
  accuseCode,
  ALIBI_RULES_VERSION,
  cardOrder,
  caseOf,
  createRun,
  MAX_ACCUSATIONS,
  missCount,
  openCode,
  openedCount,
  play,
  potential,
  refusal,
  say,
  starsOf,
  stop,
  submission,
  suspectOrder,
  CARD_COST,
  type AlibiRun,
} from "@/lib/games/alibi";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { isPracticeBoard } from "@/lib/games/offline";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import { points } from "@/lib/format";
import { currentLanguage, t, type Language } from "@/lib/settings/language";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";

const RULES = GAME_RULES.alibi;

/** Powehi, our full-length mystery cases: one quiet line after the reveal. */
const POWEHI_URL = "https://powehi-case.vercel.app";

const ENGINE: DailyEngine<AlibiRun> = {
  rulesVersion: ALIBI_RULES_VERSION,
  // The answers load only when a run starts, so they are not in the code that
  // draws the catalogue or the case.
  create: async (session) => {
    const { ALIBI_ANSWERS } = await import("@/lib/games/alibi-answers");
    return createRun(session.seed, ALIBI_ANSWERS, session.rulesVersion);
  },
  over: (run) => run.outcome !== "playing",
  submission,
};

const KIND_ICON: Record<CardKind, LucideIcon> = {
  log: ScrollText,
  message: MessageSquare,
  receipt: Receipt,
  notice: StickyNote,
  report: FileText,
  photo: ImageIcon,
};

/** Alibi, playing for real: three suspects, a few files, and one lie. */
export function AlibiRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  autoStart?: boolean;
}) {
  const state = useDailyRun(slug, ENGINE, autoStart);
  const { play: step } = state;
  const onMove = useCallback((code: number) => step((r) => play(r, code)), [step]);
  const onStop = useCallback(() => step(stop), [step]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Fingerprint className="size-5 text-muted-foreground" />}
      playLabel={t("Open today's case")}
      loadingLabel={t("Fetching today's case…")}
      doneTitle={t("You've solved today's case")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          practice={isPracticeBoard(session)}
          onMove={onMove}
          onStop={onStop}
        />
      )}
      finished={(run, result) => (
        <DailyResult
          slug={slug}
          result={result}
          headline={headlineFor(run)}
          stats={[
            { label: t("Files opened"), value: `${openedCount(run)}/${run.opened.length}` },
            {
              label: t("Accusations"),
              value: `${run.accusations.length}/${MAX_ACCUSATIONS}`,
            },
          ]}
          share={alibiShare(run)}
        >
          <Verdict run={run} language={currentLanguage()} />
        </DailyResult>
      )}
    />
  );
}

function headlineFor(run: AlibiRun): ReactNode {
  if (run.ending === "solved") {
    return (
      <span className="flex flex-col items-center gap-1">
        <span aria-label={t("{n} of 3 stars", { n: starsOf(run) })}>
          {"★".repeat(starsOf(run))}
          <span className="opacity-25">{"★".repeat(3 - starsOf(run))}</span>
        </span>
        {t("Case closed!")}
      </span>
    );
  }
  return t("The liar got away");
}

/** One row of files, opened or not, in the order the board showed them, then the accusations. */
function alibiShare(run: AlibiRun): DailyShare {
  const files = cardOrder(run.day, run.opened.length)
    .map((place) => (run.opened[place] ? "📂" : "📁"))
    .join("");
  const accusations = run.accusations.map((a) => (a.correct ? "✅" : "❌")).join("");
  return {
    day: run.day,
    result: run.ending === "solved" ? "⭐".repeat(starsOf(run)) : "X",
    grid: [`🔎 ${files}`, accusations].filter(Boolean).join("\n"),
  };
}

/** The reveal: who was lying, the file that proves it, and the detective's note. */
function Verdict({ run, language }: { run: AlibiRun; language: Language }) {
  const alibiCase = caseOf(run);
  const culprit = alibiCase.suspects[run.answer.culprit]!;
  const proof = alibiCase.cards[run.answer.proof]!;
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col gap-3 text-left text-sm">
      <div className="rounded-2xl bg-surface p-4">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t("The liar")}
        </p>
        <p className="text-base font-semibold">
          {say(culprit.name, language)} · {say(culprit.role, language)}
        </p>
        <p className="mt-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {t("The proof")}
        </p>
        <p className="font-medium">{say(proof.title, language)}</p>
        <p className="text-muted-foreground">{say(proof.body, language)}</p>
        {run.solution && <p className="mt-3 leading-relaxed">{say(run.solution, language)}</p>}
      </div>
      <p className="text-center text-xs text-muted-foreground">
        {t("Liked this? Powehi has full-length cases to solve alone or with friends.")}{" "}
        <a
          href={POWEHI_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2"
        >
          {t("Try Powehi →")}
        </a>
      </p>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((part) => part && !/^(Ms|Mr|Mrs)$/.test(part))
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Board({
  run,
  verifying,
  ranked,
  practice,
  onMove,
  onStop,
}: {
  run: AlibiRun;
  verifying: boolean;
  ranked: ReactNode;
  /** An Unlimited round or a past day: not today's case, and not ranked. */
  practice: boolean;
  onMove: (code: number) => void;
  onStop: () => void;
}) {
  const language = currentLanguage();
  const alibiCase = caseOf(run);
  const suspects = useMemo(() => suspectOrder(run.day), [run.day]);
  const files = useMemo(
    () => cardOrder(run.day, alibiCase.cards.length),
    [run.day, alibiCase.cards.length],
  );
  const [accusing, setAccusing] = useState(false);
  const [suspect, setSuspect] = useState<number | null>(null);
  const [proof, setProof] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const live = !verifying && run.outcome === "playing";
  const missed = missCount(run);

  useGameSounds({
    moves: run.moves.length,
    score: run.ending === "solved" ? potential(run) : 0,
    mistakes: missed,
    over: run.outcome === "over",
    ending: run.ending === "solved" ? "win" : run.ending === "out" ? "lose" : "stop",
  });
  useReportRunProgress(live, onStop);

  function open(card: number) {
    if (!live || refusal(run, openCode(card)) !== null) return;
    setNotice(null);
    onMove(openCode(card));
  }

  function startAccusing() {
    setAccusing(true);
    setSuspect(null);
    setProof(null);
    setNotice(
      openedCount(run) === 0
        ? t("Open a file first: an accusation needs proof.")
        : t("Pick the suspect who is lying, then the file that proves it."),
    );
  }

  function accuse() {
    if (!live || suspect === null || proof === null) return;
    const code = accuseCode(suspect, proof);
    if (refusal(run, code) === "repeat") {
      setNotice(t("You've already made that accusation."));
      return;
    }
    if (refusal(run, code) !== null) return;
    const right = suspect === run.answer.culprit && proof === run.answer.proof;
    setAccusing(false);
    setSuspect(null);
    setProof(null);
    setNotice(
      right
        ? null
        : missed + 1 >= MAX_ACCUSATIONS
          ? null
          : t("That doesn't hold up. One accusation left."),
    );
    onMove(code);
  }

  const accusationsLeft = MAX_ACCUSATIONS - run.accusations.length;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          {t("Worth {points}", { points: points(potential(run)).toLocaleString(language) })}
        </span>
        {ranked}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-4 pt-1">
        <header className="text-center">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {practice ? t("A past case") : say(alibiCase.setting, language)}
          </p>
          <h2 className="text-xl font-semibold">{say(alibiCase.title, language)}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{say(alibiCase.setup, language)}</p>
        </header>

        <section aria-label={t("Suspects")} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("Suspects")}
          </h3>
          {suspects.map((place) => (
            <SuspectCard
              key={place}
              suspect={alibiCase.suspects[place]!}
              language={language}
              picking={accusing && live}
              picked={suspect === place}
              onPick={() => setSuspect(place)}
            />
          ))}
        </section>

        <section aria-label={t("Evidence")} className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            {t("Evidence")}
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            {files.map((place) => {
              const card = alibiCase.cards[place]!;
              const Icon = KIND_ICON[card.kind];
              const opened = run.opened[place]!;
              const pickable = accusing && live && opened;
              if (!opened) {
                return (
                  <button
                    key={place}
                    type="button"
                    aria-disabled={!live || accusing}
                    onClick={() => !accusing && open(place)}
                    className={cn(
                      "flex min-h-14 items-center gap-3 rounded-xl bg-surface-2 px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none",
                      live && !accusing ? "hover:bg-surface" : "cursor-default opacity-60",
                    )}
                  >
                    <FolderClosed className="size-5 shrink-0 text-muted-foreground" />
                    <span className="flex-1">
                      <span className="block font-medium">{say(card.title, language)}</span>
                      <span className="text-xs text-muted-foreground">
                        {t("Open · −{points}", { points: points(CARD_COST) })}
                      </span>
                    </span>
                  </button>
                );
              }
              return (
                <button
                  key={place}
                  type="button"
                  aria-pressed={pickable ? proof === place : undefined}
                  aria-disabled={!pickable}
                  onClick={() => pickable && setProof(place)}
                  className={cn(
                    "flex flex-col gap-1 rounded-xl border px-3 py-2 text-left text-sm transition-colors motion-reduce:transition-none",
                    proof === place && pickable
                      ? "border-foreground bg-foreground text-background"
                      : "border-border bg-surface",
                    pickable ? "cursor-pointer" : "cursor-default",
                  )}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="size-4 shrink-0 opacity-70" />
                    {say(card.title, language)}
                  </span>
                  <span className={cn(proof === place && pickable ? "" : "text-muted-foreground")}>
                    {say(card.body, language)}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {run.accusations.length > 0 && (
          <ul className="flex flex-col gap-1 text-sm" aria-label={t("Accusations")}>
            {run.accusations.map((a, i) => (
              <li key={i} className="flex items-center gap-2">
                {a.correct ? (
                  <Check className="size-4 text-emerald-500" />
                ) : (
                  <X className="size-4 text-red-500" />
                )}
                <span>
                  {say(alibiCase.suspects[a.suspect]!.name, language)} ·{" "}
                  {say(alibiCase.cards[a.card]!.title, language)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <span>{t("Accusations left:")}</span>
          <span
            className="flex gap-1"
            aria-label={t("{n} accusations left", { n: accusationsLeft })}
          >
            {Array.from({ length: MAX_ACCUSATIONS }, (_, i) => (
              <span
                key={i}
                className={cn(
                  "size-3 rounded-full",
                  i < accusationsLeft ? "bg-foreground/70" : "bg-foreground/15",
                )}
              />
            ))}
          </span>
        </div>

        <p className="min-h-5 text-center text-sm font-medium" aria-live="polite">
          {verifying ? t("Verifying your run with the server…") : notice}
        </p>

        {live && (
          <div className="flex flex-wrap justify-center gap-2">
            {accusing ? (
              <>
                <Button
                  variant="play"
                  disabled={suspect === null || proof === null}
                  onClick={accuse}
                >
                  <Gavel className="size-4" />
                  {t("Accuse")}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setAccusing(false);
                    setNotice(null);
                  }}
                >
                  {t("Back to the files")}
                </Button>
              </>
            ) : (
              <Button variant="play" onClick={startAccusing}>
                <Gavel className="size-4" />
                {t("Make an accusation")}
              </Button>
            )}
          </div>
        )}

        {live && (
          <div className="flex justify-center">
            <EndRunButton
              label={t("Close the case")}
              title={practice ? t("Close this case?") : t("Close today's case?")}
              body={
                practice
                  ? t(
                      "The case ends unsolved and you'll see who did it. It's practice, so nothing is lost.",
                    )
                  : t(
                      "The case ends unsolved, scores nothing, and you'll see who did it. There is one ranked case a day.",
                    )
              }
              keep={t("Keep investigating")}
              onConfirm={onStop}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function SuspectCard({
  suspect,
  language,
  picking,
  picked,
  onPick,
}: {
  suspect: Suspect;
  language: Language;
  picking: boolean;
  picked: boolean;
  onPick: () => void;
}) {
  const name = say(suspect.name, language);
  return (
    <button
      type="button"
      aria-pressed={picking ? picked : undefined}
      aria-disabled={!picking}
      onClick={() => picking && onPick()}
      className={cn(
        "flex gap-3 rounded-xl px-3 py-3 text-left text-sm transition-colors motion-reduce:transition-none",
        picked && picking ? "bg-foreground text-background" : "bg-surface-2",
        picking ? "cursor-pointer hover:ring-2 hover:ring-foreground/30" : "cursor-default",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
          picked && picking ? "bg-background text-foreground" : "bg-surface text-foreground",
        )}
      >
        {initials(name)}
      </span>
      <span className="flex-1">
        <span className="block font-semibold">
          {name} <span className="font-normal opacity-70">· {say(suspect.role, language)}</span>
        </span>
        {suspect.statedAt && (
          <span className="block text-xs opacity-70">{say(suspect.statedAt, language)}</span>
        )}
        <span className="mt-1 block leading-relaxed">“{say(suspect.statement, language)}”</span>
      </span>
    </button>
  );
}
