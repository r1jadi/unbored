import { Link } from "@tanstack/react-router";
import { Loader2, RotateCcw, ShieldCheck, Trophy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ErrorState } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { ExitGameLink } from "@/components/game/ExitGameLink";
import { LevelUpOverlay } from "@/components/game/LevelUp";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { levelUpHold, useLevelUp } from "@/lib/games/level-up";
import { useReportRunProgress } from "@/lib/games/run-progress";
import {
  playErrorMessage,
  useChainRun,
  type PlaySession,
  type RunResult,
} from "@/lib/games/sessions";
import {
  CHAIN_PADS,
  chainTempo,
  symbolAt,
  totalTapsThrough,
  type ChainRun,
} from "@/lib/games/chain";

/**
 * Chain, playing for real.
 *
 * The board is a view onto `useChainRun`, which owns the whole lifecycle: a
 * session issued by the server, the run played against its sequence, and the
 * score the server derived from the submitted tap list. Nothing on this screen
 * decides a number — the score shown at the end is the one that came back from
 * verification, and until it does the screen says the run is being verified
 * rather than showing a provisional total.
 *
 * Three things the component refuses to do, because each would be a lie:
 *
 *   - **it never offers a tap out of turn.** While the sequence is showing, the
 *     pads are disabled and say so; a tap that arrives one frame after the run
 *     ended lands on a disabled pad rather than throwing inside a render.
 *   - **it never reveals the sequence during input.** The pads light only while
 *     showing; repeating is the player's memory, not the board's.
 *   - **it never claims a score was saved.** A failed submission is an error with
 *     the server's own message and a retry that re-sends the identical run, not a
 *     local "saved" that a reload would disprove.
 */
export function ChainRuntime({ slug, title }: { slug: string; title: string }) {
  const state = useChainRun(slug);

  if (state.status === "starting") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Starting a run…</p>
      </div>
    );
  }

  if (state.status === "error" && state.stage === "start") {
    return (
      <div className="flex flex-1 flex-col justify-center px-6">
        <ErrorState
          title="Couldn't start a run"
          body={playErrorMessage(state.error)}
          onRetry={state.retry}
        />
      </div>
    );
  }

  // A submission failure keeps the board: the run exists, it is just not verified,
  // and offering to throw it away would be the one thing the player cannot undo.
  if (state.status === "error" && state.stage === "submit" && state.run && state.session) {
    return (
      <div className="flex flex-1 flex-col justify-center gap-4 px-6 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
          <TriangleAlert className="size-5 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-semibold">Your run was not verified</h2>
        <p className="mx-auto max-w-sm text-sm text-muted-foreground">
          {playErrorMessage(state.error)} Nothing was saved, and nothing needs to be — sending the
          same run again is safe.
        </p>
        <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
          <Button variant="play" size="lg" onClick={state.retry}>
            Try submitting again
          </Button>
          <Button variant="secondary" size="lg" onClick={state.restart}>
            <RotateCcw />
            Start a new run
          </Button>
          <Button asChild variant="ghost" size="lg">
            <ExitGameLink slug={slug}>{title}</ExitGameLink>
          </Button>
        </div>
      </div>
    );
  }

  if (state.status === "playing" || state.status === "submitting") {
    return (
      <Board
        // A fresh board per run: the showing always replays from round one, even
        // when the next session deals the same seed.
        key={state.session.id}
        run={state.run}
        session={state.session}
        verifying={state.status === "submitting"}
        onTap={state.tap}
        onFinish={state.finish}
      />
    );
  }

  if (state.status === "finished") {
    return (
      <Finished
        slug={slug}
        title={title}
        result={state.result}
        stopped={state.run.stopped === true}
        onRestart={state.restart}
      />
    );
  }

  // The only remaining shape is an error with no run to show, which the branches
  // above have already handled; a spinner is a truthful fallback rather than a
  // screen that invents a state.
  return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

/** One pad's colour, dimmed until it lights. */
const PAD_STYLES = ["bg-game-1", "bg-game-2", "bg-game-4", "bg-game-5"] as const;

/** The beat before the first step, so the board settles before it starts. */
const LEAD_IN_MS = 350;

/** Whether `round` is the first round played at the tempo's floor. */
function reachesTopSpeed(round: number): boolean {
  const now = chainTempo(round);
  const before = chainTempo(round - 1);
  const after = chainTempo(round + 1);
  const steady = now.litMs === after.litMs && now.gapMs === after.gapMs;
  const changed = now.litMs !== before.litMs || now.gapMs !== before.gapMs;
  return steady && changed;
}

/** The live board: a showing phase, then an input phase, per round. */
function Board({
  run,
  session,
  verifying,
  onTap,
  onFinish,
}: {
  run: ChainRun;
  session: PlaySession;
  verifying: boolean;
  onTap: (pad: number) => void;
  /** Ends the run where it stands and submits it. */
  onFinish: () => void;
}) {
  const [showing, setShowing] = useState(true);
  const [lit, setLit] = useState<number | null>(null);
  const round = run.round;
  const seed = run.seed;

  // A repeated chain gets a beat before the next one, and the next sequence
  // waits for it. The beat says so once when the tempo reaches its floor.
  const topSpeed = round > 1 && reachesTopSpeed(round);
  const holdMs = levelUpHold(topSpeed);
  const levelUp = useLevelUp(round, run.score, holdMs);
  const firstRound = useRef(round);

  // Each round starts by showing its symbols, then hands over to the player.
  // The effect re-runs only when the round (or run) changes: taps within a
  // round must not restart the showing.
  useEffect(() => {
    setShowing(true);
    setLit(null);
    // A round reached by repeating the last one waits for the level-up beat.
    const delay = round === firstRound.current ? 0 : holdMs;
    const steps = Array.from({ length: round }, (_, i) => symbolAt(seed, i));
    const { litMs, gapMs } = chainTempo(round);
    const timers: ReturnType<typeof setTimeout>[] = [];
    steps.forEach((pad, i) => {
      const at = delay + LEAD_IN_MS + i * (litMs + gapMs);
      timers.push(setTimeout(() => setLit(pad), at));
      timers.push(setTimeout(() => setLit(null), at + litMs));
    });
    timers.push(
      setTimeout(() => setShowing(false), delay + LEAD_IN_MS + steps.length * (litMs + gapMs)),
    );
    return () => {
      timers.forEach(clearTimeout);
      setLit(null);
    };
    // `holdMs` follows the round; the showing restarts only with a new round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, seed]);

  const accepting = !showing && !levelUp && !verifying && run.outcome === "playing";

  // From the first showing beat the run is live: leaving loses it.
  useReportRunProgress(!verifying && run.outcome === "playing", onFinish);

  // Taps taken in this round so far: the round replays the sequence from its
  // start, so this is also the position the next tap is checked against.
  const taken = run.taps.length - totalTapsThrough(round - 1);

  // Number keys tap a pad, like a pointer would. Only while the board accepts
  // taps: during the showing, or verification, a keypress must do nothing.
  useEffect(() => {
    if (!accepting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const pad = Number.parseInt(event.key, 10);
      if (!Number.isInteger(pad) || pad < 1 || pad > CHAIN_PADS) return;
      event.preventDefault();
      onTap(pad - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accepting, onTap]);

  return (
    <div className="flex flex-1 flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-3 py-2">
        <dl className="flex items-baseline gap-1">
          <dt className="text-xs text-muted-foreground">Score</dt>
          <dd className="text-2xl font-semibold tabular">{run.score}</dd>
        </dl>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="tabular">Round {round}</span>
          {session.ranked ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-1">
              <ShieldCheck className="size-3.5" />
              Ranked
            </span>
          ) : (
            <span className="rounded-full bg-surface-2 px-2 py-1">Guest run</span>
          )}
        </div>
      </div>

      <p className="py-1 text-center text-sm text-muted-foreground" aria-live="polite">
        {verifying
          ? "Verifying your run with the server…"
          : showing
            ? `Round ${round}: watch ${round} ${round === 1 ? "tap" : "taps"}…`
            : `Your turn — repeat ${round} ${round === 1 ? "tap" : "taps"}.`}
      </p>

      <div
        className="relative mx-auto grid w-full max-w-md flex-1 grid-cols-2 content-center gap-3 py-3"
        role="group"
        aria-label="Pads"
      >
        {PAD_STYLES.map((color, index) => {
          const isLit = lit === index;
          return (
            <button
              key={index}
              type="button"
              disabled={!accepting}
              onClick={() => onTap(index)}
              aria-label={padLabel(index, taken, round, showing, verifying, run.outcome)}
              className={cn(
                "press flex min-h-28 items-center justify-center rounded-2xl border transition-all duration-150",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "active:scale-[0.97]",
                color,
                isLit
                  ? "scale-[1.03] border-transparent opacity-100 brightness-125"
                  : accepting
                    ? "border-transparent opacity-80 hover:opacity-100"
                    : "border-transparent opacity-35",
              )}
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full font-mono text-sm font-semibold tabular",
                  "bg-background/70 text-foreground",
                )}
              >
                {index + 1}
              </span>
            </button>
          );
        })}
        {levelUp && (
          <LevelUpOverlay
            levelUp={levelUp}
            unit="Round"
            next={`Round ${round} · ${round} taps`}
            note={topSpeed ? "Top speed: the beat stops getting faster." : undefined}
          />
        )}
      </div>

      <p className="pt-1 text-center text-xs text-muted-foreground" aria-live="polite">
        {verifying
          ? "The taps so far are your score if the server agrees."
          : "Every round adds a tap and tightens the beat. A wrong tap ends the run."}
      </p>
      <EndRunButton
        score={run.score}
        disabled={verifying || run.outcome !== "playing"}
        onEnd={onFinish}
      />
    </div>
  );
}

/** The accessible name of a pad, which states why a tap is or is not playable. */
function padLabel(
  index: number,
  taken: number,
  round: number,
  showing: boolean,
  verifying: boolean,
  outcome: ChainRun["outcome"],
): string {
  const position = `Pad ${index + 1}`;
  if (verifying) return `${position}. The run is being verified.`;
  if (outcome !== "playing") return `${position}. The run has ended.`;
  if (showing) return `${position}. Watch the sequence.`;
  return `${position}. Tap to repeat step ${taken + 1} of ${round}.`;
}

/** The end of a run: the score the server verified, or a guest's unranked result. */
function Finished({
  slug,
  title,
  result,
  stopped,
  onRestart,
}: {
  slug: string;
  title: string;
  result: RunResult;
  stopped: boolean;
  onRestart: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-4 px-6 pb-[max(1rem,env(safe-area-inset-bottom))] text-center">
      <div className="enter flex flex-col items-center gap-2">
        <div className="flex size-12 items-center justify-center rounded-full bg-surface-2">
          {result.ranked ? (
            <Trophy className="size-5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="size-5 text-muted-foreground" />
          )}
        </div>
        <p className="text-sm text-muted-foreground">{stopped ? "Run ended" : "Chain broken"}</p>
        <p className="text-5xl font-semibold tabular">{result.score}</p>
        <p className="text-sm text-muted-foreground">
          {`${result.tilesPlaced} taps placed, ${result.clearedColumns} rounds cleared.`}
        </p>
      </div>

      <dl className="mx-auto grid w-full max-w-xs grid-cols-2 gap-2 text-sm">
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Duration</dt>
          <dd className="font-semibold tabular">{formatDuration(result.durationMs)}</dd>
        </div>
        <div className="rounded-xl bg-surface p-3">
          <dt className="text-xs text-muted-foreground">Rounds cleared</dt>
          <dd className="font-semibold tabular">{result.clearedColumns}</dd>
        </div>
        {result.personalBest !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Your best</dt>
            <dd className="font-semibold tabular">{result.personalBest}</dd>
          </div>
        )}
        {result.rank !== null && (
          <div className="rounded-xl bg-surface p-3">
            <dt className="text-xs text-muted-foreground">Rank</dt>
            <dd className="font-semibold tabular">#{result.rank}</dd>
          </div>
        )}
      </dl>

      <p className="mx-auto max-w-sm text-xs text-muted-foreground">
        {result.ranked
          ? "Verified by replaying your taps on the server, then saved to the leaderboard."
          : "Verified by replaying your taps on the server. This was a guest run, so it is not on the leaderboard."}
        {result.duplicate && " This run was already recorded, so nothing was counted twice."}
      </p>

      <div className="mx-auto flex w-full max-w-xs flex-col gap-2">
        <Button variant="play" size="lg" onClick={onRestart}>
          <RotateCcw />
          Play again
        </Button>
        <Button asChild variant="secondary" size="lg">
          <Link to="/leaderboards/$id" params={{ id: slug }}>
            See the leaderboard
          </Link>
        </Button>
        {!result.ranked && (
          <Button asChild variant="ghost" size="lg">
            <Link to="/login" search={{ redirect: `/games/${slug}` }}>
              Sign in to rank your scores
            </Link>
          </Button>
        )}
      </div>
    </div>
  );
}

/** Milliseconds as `m:ss`. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
