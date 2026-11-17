import { ChevronLeft, ChevronRight, Flag, Wind } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";

import { DailyFrame, DailyResult, EndRunButton, RankChip } from "@/components/game/DailyShell";
import { Button } from "@/components/ui/button";
import { isPracticeBoard } from "@/lib/games/offline";
import { useDailyRun, type DailyEngine } from "@/lib/games/daily-run";
import { GAME_RULES } from "@/lib/games/rules";
import { useReportRunProgress } from "@/lib/games/run-progress";
import type { DailyShare } from "@/lib/games/share";
import {
  angleTo,
  CLUBS,
  coursePar,
  createRun,
  currentHole,
  fullCarry,
  heading,
  HOLES,
  holePoints,
  INNER_RING,
  OUTER_RING,
  playShot,
  scoreOf,
  stop,
  submission,
  suggestedClub,
  TEE_TIME_RULES_VERSION,
  yardsToPin,
  type Hole,
  type HoleCard,
  type TeeTimeRun,
} from "@/lib/games/tee-time";
import { points } from "@/lib/format";
import { useGameSounds } from "@/lib/sound";
import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

const RULES = GAME_RULES["tee-time"];
/** One sweep of the meter, empty to full, in milliseconds. */
const SWEEP_MS = 950;
const FLIGHT_MS = 900;

const ENGINE: DailyEngine<TeeTimeRun> = {
  rulesVersion: TEE_TIME_RULES_VERSION,
  create: (session) => createRun(session.seed, session.rulesVersion),
  over: (run) => run.outcome !== "playing",
  submission,
};

/** Tee Time, playing for real: the day's nine holes. */
export function TeeTimeRuntime({
  slug,
  title,
  autoStart = false,
}: {
  slug: string;
  title: string;
  autoStart?: boolean;
}) {
  const state = useDailyRun(slug, ENGINE, autoStart);
  const play = state.play;
  const onShot = useCallback(
    (club: number, angle: number, power: number) =>
      play((run) => playShot(run, { club, angle, power })),
    [play],
  );
  const onStop = useCallback(() => play(stop), [play]);
  return (
    <DailyFrame
      state={state}
      slug={slug}
      title={title}
      rules={RULES}
      icon={<Flag className="size-5 text-muted-foreground" />}
      playLabel={t("Tee off")}
      loadingLabel={t("Building today's course…")}
      doneTitle={t("You've played today's course")}
      board={(session, run, verifying) => (
        <Board
          key={session.id}
          run={run}
          verifying={verifying}
          ranked={<RankChip session={session} />}
          practice={isPracticeBoard(session)}
          onShot={onShot}
          onStop={onStop}
        />
      )}
      finished={(run, result) => {
        const strokes = run.cards.reduce((sum, card) => sum + card.strokes, 0);
        const par = run.course.slice(0, run.cards.length).reduce((sum, h) => sum + h.par, 0);
        return (
          <DailyResult
            slug={slug}
            result={result}
            headline={
              run.ending === "finished"
                ? t("Round complete: {strokes} strokes ({toPar})", {
                    strokes,
                    toPar: toPar(strokes - par),
                  })
                : t("{n} of {max} holes played", { n: run.cards.length, max: HOLES })
            }
            stats={[
              { label: t("Strokes"), value: strokes },
              { label: t("Course par"), value: coursePar(run.course) },
            ]}
            share={teeTimeShare(run)}
          >
            <Scorecard run={run} wide />
          </DailyResult>
        );
      }}
    />
  );
}

function toPar(diff: number): string {
  return diff === 0 ? "E" : diff > 0 ? `+${diff}` : `${diff}`;
}

function cardMark(par: number, strokes: number): string {
  const d = strokes - par;
  if (strokes === 1) return "🎯";
  if (d <= -1) return "🟩";
  if (d === 0) return "⬜";
  if (d === 1) return "🟨";
  return "🟥";
}

/** One square per hole: 🎯 an ace, green under par, white par, amber a bogey, red worse. */
function teeTimeShare(run: TeeTimeRun): DailyShare {
  const strokes = run.cards.reduce((sum, card) => sum + card.strokes, 0);
  const par = run.course.slice(0, run.cards.length).reduce((sum, h) => sum + h.par, 0);
  return {
    day: run.day,
    result: run.cards.length ? `${strokes} (${toPar(strokes - par)})` : "—",
    grid: run.cards.map((card, i) => cardMark(run.course[i]!.par, card.strokes)).join("") || "—",
  };
}

function Scorecard({ run, wide = false }: { run: TeeTimeRun; wide?: boolean }) {
  return (
    <ol
      className={cn("mx-auto grid w-full grid-cols-9 gap-1", wide ? "max-w-sm" : "max-w-md")}
      aria-label={t("Scorecard")}
    >
      {run.course.map((hole, i) => {
        const card: HoleCard | undefined = run.cards[i];
        const d = card ? card.strokes - hole.par : 0;
        return (
          <li
            key={i}
            className={cn(
              "flex flex-col items-center rounded-md bg-surface py-1 text-[0.65rem] leading-tight",
              i === run.hole && run.outcome === "playing" && "ring-2 ring-primary",
            )}
            aria-label={
              card
                ? t("Hole {n}, par {par}: {strokes}", {
                    n: i + 1,
                    par: hole.par,
                    strokes: card.strokes,
                  })
                : t("Hole {n}, par {par}", { n: i + 1, par: hole.par })
            }
          >
            <span className="text-muted-foreground">{i + 1}</span>
            <span
              className={cn(
                "text-sm font-semibold tabular",
                card && d < 0 && "text-primary",
                card && d > 0 && "text-muted-foreground",
              )}
            >
              {card ? card.strokes : "·"}
            </span>
            <span className="text-muted-foreground">{t("P{par}", { par: hole.par })}</span>
          </li>
        );
      })}
    </ol>
  );
}

function resultWord(par: number, strokes: number): string {
  if (strokes === 1) return t("Hole in one!");
  const d = strokes - par;
  if (d <= -3) return t("Albatross!");
  if (d === -2) return t("Eagle!");
  if (d === -1) return t("Birdie!");
  if (d === 0) return t("Par");
  if (d === 1) return t("Bogey");
  if (d === 2) return t("Double bogey");
  return t("{n} over par", { n: d });
}

type Point = { x: number; y: number };

/** The flight of the last shot, as a point along from → landing → rest at time `p` (0–1). */
function along(from: Point, landing: Point, rest: Point, p: number): Point {
  if (p < 0.75) {
    const q = p / 0.75;
    return { x: from.x + (landing.x - from.x) * q, y: from.y + (landing.y - from.y) * q };
  }
  const q = (p - 0.75) / 0.25;
  return { x: landing.x + (rest.x - landing.x) * q, y: landing.y + (rest.y - landing.y) * q };
}

function Board({
  run,
  verifying,
  ranked,
  practice,
  onShot,
  onStop,
}: {
  run: TeeTimeRun;
  verifying: boolean;
  ranked: ReactNode;
  /** An Unlimited round or a past day: not today's board, and not ranked. */
  practice: boolean;
  onShot: (club: number, angle: number, power: number) => void;
  onStop: () => void;
}) {
  const hole = currentHole(run);
  // The hole on screen: after a hole is finished it stays up until Next hole.
  const [shownHole, setShownHole] = useState(run.hole);
  const showing = run.course[Math.min(shownHole, HOLES - 1)]!;
  const between = shownHole !== run.hole;
  const [club, setClub] = useState(() => (hole ? suggestedClub(hole, run.ball) : 0));
  const [aim, setAim] = useState(() => (hole ? angleTo(run.ball, hole.pin) : 0));
  const [swinging, setSwinging] = useState(false);
  const [meter, setMeter] = useState(0);
  const [flight, setFlight] = useState<number | null>(null);
  const swingStart = useRef(0);
  const live = !verifying && run.outcome === "playing" && !between && flight === null;

  useGameSounds({
    moves: run.moves.length,
    score: scoreOf(run),
    cleared: run.cards.length,
    over: run.outcome === "over",
    ending: "win",
  });
  useReportRunProgress(!verifying && run.outcome === "playing", onStop);

  // A new lie: aim at the pin with the club that reaches it.
  const ballKey = `${run.hole}:${run.ball.x}:${run.ball.y}:${run.strokes}`;
  useEffect(() => {
    if (!hole) return;
    setClub(suggestedClub(hole, run.ball));
    setAim(angleTo(run.ball, hole.pin));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ballKey]);

  // The last shot flies before anything else happens.
  const shots = run.moves.length;
  useEffect(() => {
    if (shots === 0 || !run.lastShot) return;
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / FLIGHT_MS);
      setFlight(p);
      if (p < 1) frame = requestAnimationFrame(tick);
      else setFlight(null);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shots]);

  // The meter sweeps up and down until it is stopped.
  useEffect(() => {
    if (!swinging) return;
    let frame = 0;
    swingStart.current = performance.now();
    const tick = (now: number) => {
      const phase = ((now - swingStart.current) / SWEEP_MS) % 2;
      setMeter(phase <= 1 ? phase * 100 : (2 - phase) * 100);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [swinging]);

  const swing = useCallback(() => {
    if (!live) return;
    if (!swinging) {
      setMeter(0);
      setSwinging(true);
      return;
    }
    setSwinging(false);
    const power = Math.max(1, Math.min(100, Math.round(meter)));
    onShot(club, aim, power);
  }, [live, swinging, meter, onShot, club, aim]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input, textarea, [role=alertdialog]")
      ) {
        return;
      }
      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        if (between) setShownHole(run.hole);
        else swing();
      } else if (!swinging && live && event.key === "ArrowLeft") {
        event.preventDefault();
        setAim((a) => (a + 359) % 360);
      } else if (!swinging && live && event.key === "ArrowRight") {
        event.preventDefault();
        setAim((a) => (a + 1) % 360);
      } else if (!swinging && live && event.key === "ArrowUp") {
        event.preventDefault();
        setClub((c) => Math.max(0, c - 1));
      } else if (!swinging && live && event.key === "ArrowDown") {
        event.preventDefault();
        setClub((c) => Math.min(CLUBS.length - 1, c + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [swing, swinging, live, between, run.hole]);

  const svg = useRef<SVGSVGElement>(null);
  function aimAt(clientX: number, clientY: number) {
    if (!live || swinging || !hole || !svg.current) return;
    const matrix = svg.current.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
    const world = { x: point.x + hole.bounds.minX, y: hole.bounds.maxY - point.y };
    setAim(angleTo(run.ball, world));
  }

  const last = run.lastShot;
  const lastCard = run.cards[shownHole];
  const ballOnScreen: Point =
    flight !== null && last
      ? along(last.from, last.landing, last.rest, flight)
      : between && last
        ? last.rest
        : run.ball;
  const carry = hole ? fullCarry(hole, run.ball, club) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-2 py-2 text-xs text-muted-foreground">
        <span className="tabular">
          {t("Hole {n} · Par {par} · {yards} yds", {
            n: shownHole + 1,
            par: showing.par,
            yards: showing.length,
          })}
        </span>
        {ranked}
      </div>

      <Scorecard run={run} />

      <div className="relative flex min-h-0 flex-1 items-center justify-center py-2">
        <CourseView
          ref={svg}
          hole={showing}
          ball={ballOnScreen}
          aim={live || swinging ? aim : null}
          carry={carry}
          trail={flight === null && last && !between ? last : null}
          onAim={aimAt}
        />
        <WindBadge hole={showing} />
        {between && lastCard && (
          <div className="absolute inset-x-4 top-1/3 mx-auto flex max-w-xs flex-col items-center gap-2 rounded-2xl bg-background/95 p-4 text-center shadow-lg">
            <p className="text-lg font-semibold">{resultWord(showing.par, lastCard.strokes)}</p>
            <p className="text-sm text-muted-foreground">
              {lastCard.pickedUp
                ? t("Picked up at {n}", { n: lastCard.strokes })
                : t("{strokes} strokes, {putts} {puttWord}", {
                    strokes: lastCard.strokes,
                    putts: lastCard.putts,
                    puttWord: lastCard.putts === 1 ? t("putt") : t("putts"),
                  })}
              {" · "}+{points(holePoints(showing.par, lastCard.strokes))}
            </p>
            <Button variant="play" onClick={() => setShownHole(run.hole)} autoFocus>
              {t("Next hole")}
            </Button>
          </div>
        )}
      </div>

      <div className="mx-auto flex w-full max-w-md flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-sm">
          <Button
            variant="secondary"
            size="icon"
            aria-label={t("Longer club")}
            disabled={!live || swinging || club === 0}
            onClick={() => setClub((c) => Math.max(0, c - 1))}
          >
            <ChevronLeft />
          </Button>
          <div className="flex-1 text-center">
            <p className="font-semibold">{t(CLUBS[club]!.name)}</p>
            <p className="text-xs text-muted-foreground tabular">
              {t("{carry} yds full · {pin} yds to pin · stroke {n}", {
                carry,
                pin: hole ? yardsToPin(hole, run.ball) : 0,
                n: run.strokes + 1,
              })}
            </p>
          </div>
          <Button
            variant="secondary"
            size="icon"
            aria-label={t("Shorter club")}
            disabled={!live || swinging || club === CLUBS.length - 1}
            onClick={() => setClub((c) => Math.min(CLUBS.length - 1, c + 1))}
          >
            <ChevronRight />
          </Button>
        </div>

        <div
          className="relative h-4 overflow-hidden rounded-full bg-surface-2"
          role="meter"
          aria-label={t("Power")}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(meter)}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: `${swinging ? meter : 0}%` }}
          />
          {[25, 50, 75].map((tick) => (
            <span
              key={tick}
              className="absolute inset-y-0 w-px bg-foreground/20"
              style={{ left: `${tick}%` }}
            />
          ))}
        </div>

        <div className="flex gap-2">
          <Button variant="play" size="lg" className="flex-1" disabled={!live} onClick={swing}>
            {swinging ? t("Stop!") : t("Swing")}
          </Button>
        </div>
        <p className="min-h-4 text-center text-xs text-muted-foreground" aria-live="polite">
          {verifying
            ? t("Verifying your round with the server…")
            : last?.penalty && flight === null && !between
              ? t("Penalty stroke: water or out of bounds.")
              : t("Tap the course to aim. Arrow keys and Space work too.")}
        </p>
        <div className="flex justify-center">
          <EndRunButton
            label={t("End round")}
            title={practice ? t("End this round here?") : t("End today's round here?")}
            body={
              practice
                ? t("Finished holes keep their points. It's practice, so nothing is lost.")
                : t(
                    "Finished holes keep their points; the rest score nothing. There is one ranked round a day.",
                  )
            }
            keep={t("Keep playing")}
            disabled={verifying || run.outcome !== "playing"}
            onConfirm={onStop}
          />
        </div>
      </div>
    </div>
  );
}

function WindBadge({ hole }: { hole: Hole }) {
  const speed = Math.round(Math.hypot(hole.wind.x, hole.wind.y));
  // The arrow points where the wind blows: up the screen is up the hole.
  const rotation = (Math.atan2(hole.wind.x, hole.wind.y) * 180) / Math.PI;
  return (
    <div className="absolute top-3 right-3 flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-1 text-xs shadow-sm">
      <Wind className="size-3.5" />
      {speed === 0 ? (
        t("Calm")
      ) : (
        <>
          <span
            className="inline-block"
            style={{ transform: `rotate(${rotation}deg)` }}
            aria-hidden
          >
            ↑
          </span>
          <span className="tabular">{t("{n} yds/100", { n: speed })}</span>
        </>
      )}
    </div>
  );
}

const COLORS = {
  rough: "#3f7d3a",
  fairway: "#62a84f",
  green: "#86cf6a",
  sand: "#e8d39a",
  water: "#4a90d9",
  tee: "#7fc06a",
};

function CourseView({
  ref,
  hole,
  ball,
  aim,
  carry,
  trail,
  onAim,
}: {
  ref: Ref<SVGSVGElement>;
  hole: Hole;
  ball: Point;
  aim: number | null;
  carry: number;
  trail: { from: Point; landing: Point; rest: Point } | null;
  onAim: (clientX: number, clientY: number) => void;
}) {
  const { minX, maxX, minY, maxY } = hole.bounds;
  const width = maxX - minX;
  const height = maxY - minY;
  const sx = (x: number) => x - minX;
  const sy = (y: number) => maxY - y;
  const step = aim === null ? null : heading(aim);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${width} ${height}`}
      className="h-full max-h-full w-auto max-w-full touch-none rounded-2xl"
      style={{ aspectRatio: `${width} / ${height}` }}
      role="img"
      aria-label={t("A par {par}, {yards} yards: the ball is {left} yards from the pin.", {
        par: hole.par,
        yards: hole.length,
        left: Math.round(Math.hypot(hole.pin.x - ball.x, hole.pin.y - ball.y)),
      })}
      onPointerDown={(event) => onAim(event.clientX, event.clientY)}
      onPointerMove={(event) => {
        if (event.buttons) onAim(event.clientX, event.clientY);
      }}
    >
      <rect x={0} y={0} width={width} height={height} fill={COLORS.rough} />
      {hole.fairway.map((d, i) => (
        <circle key={`f${i}`} cx={sx(d.x)} cy={sy(d.y)} r={d.r} fill={COLORS.fairway} />
      ))}
      <circle cx={sx(0)} cy={sy(0)} r={5} fill={COLORS.tee} />
      {hole.water.map((d, i) => (
        <circle key={`w${i}`} cx={sx(d.x)} cy={sy(d.y)} r={d.r} fill={COLORS.water} />
      ))}
      {hole.bunkers.map((d, i) => (
        <circle key={`b${i}`} cx={sx(d.x)} cy={sy(d.y)} r={d.r} fill={COLORS.sand} />
      ))}
      <circle cx={sx(hole.pin.x)} cy={sy(hole.pin.y)} r={hole.green} fill={COLORS.green} />
      <circle
        cx={sx(hole.pin.x)}
        cy={sy(hole.pin.y)}
        r={OUTER_RING}
        fill="none"
        stroke="#ffffff"
        strokeOpacity={0.55}
        strokeWidth={0.6}
      />
      <circle
        cx={sx(hole.pin.x)}
        cy={sy(hole.pin.y)}
        r={INNER_RING}
        fill="#f5c542"
        fillOpacity={0.35}
        stroke="#f5c542"
        strokeWidth={0.6}
      />
      <line
        x1={sx(hole.pin.x)}
        y1={sy(hole.pin.y)}
        x2={sx(hole.pin.x)}
        y2={sy(hole.pin.y) - 9}
        stroke="#ffffff"
        strokeWidth={0.8}
      />
      <polygon
        points={`${sx(hole.pin.x)},${sy(hole.pin.y) - 9} ${sx(hole.pin.x) + 6},${sy(hole.pin.y) - 7} ${sx(hole.pin.x)},${sy(hole.pin.y) - 5}`}
        fill="#e5484d"
      />
      {trail && (
        <polyline
          points={`${sx(trail.from.x)},${sy(trail.from.y)} ${sx(trail.landing.x)},${sy(trail.landing.y)} ${sx(trail.rest.x)},${sy(trail.rest.y)}`}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.5}
          strokeWidth={0.8}
          strokeDasharray="2 2"
        />
      )}
      {step && (
        <>
          <line
            x1={sx(ball.x)}
            y1={sy(ball.y)}
            x2={sx(ball.x + (step.dx * carry) / 10000)}
            y2={sy(ball.y + (step.dy * carry) / 10000)}
            stroke="#ffffff"
            strokeWidth={1}
            strokeDasharray="3 2"
          />
          <circle
            cx={sx(ball.x + (step.dx * carry) / 10000)}
            cy={sy(ball.y + (step.dy * carry) / 10000)}
            r={3}
            fill="none"
            stroke="#ffffff"
            strokeWidth={0.8}
          />
        </>
      )}
      <circle
        cx={sx(ball.x)}
        cy={sy(ball.y)}
        r={3}
        fill="#ffffff"
        stroke="#1f2937"
        strokeWidth={0.5}
      />
    </svg>
  );
}
