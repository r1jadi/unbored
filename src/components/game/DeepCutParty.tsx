import {
  Bomb,
  Heart,
  Loader2,
  Minus,
  PartyPopper,
  Plus,
  RotateCcw,
  SendHorizontal,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api/client";
import { tierInfo, type Tier } from "@/lib/games/deep-cut";
import {
  alive,
  answerRound,
  boom,
  dealRound,
  fuseLength,
  newPlayers,
  nextAlive,
  PARTY_MAX_PLAYERS,
  PARTY_MAX_ROUNDS,
  PARTY_MIN_PLAYERS,
  scored,
  standings,
  startParty,
  tidyNames,
  type PartyPlayer,
  type PartyRound,
  type PartyVerdict,
} from "@/lib/games/deep-cut-party";
import { playErrorMessage } from "@/lib/games/sessions";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

/** What the table sees after an answer, until the next one. */
type Note =
  | { kind: "passed"; by: string; canonical: string; tier: Tier; points: number }
  | { kind: "refused"; text: string; suggestions: string[] };

type Phase =
  | { status: "setup" }
  | { status: "starting" }
  | {
      status: "playing";
      round: PartyRound;
      holder: number;
      /** When the fuse goes off, device time. Hidden from the players. */
      fuseAt: number;
      startedAt: number;
      note: Note | null;
    }
  | { status: "boom"; round: PartyRound; victim: number }
  | { status: "over" }
  | { status: "error"; message: string; retry: () => void };

const REFUSALS: Record<Exclude<PartyVerdict["result"], "valid" | "repeat">, string> = {
  invalid: "Not a valid answer. Try another.",
  ambiguous: "That's close to more than one answer. Check the spelling.",
  unknown: "We can't check that one right now. Try another.",
  empty: "Type an answer first.",
};

/**
 * Hot potato for a table of 2–8, on one phone. See `@/lib/games/deep-cut-party`.
 */
export function DeepCutParty({ onExit }: { onExit: () => void }) {
  const [names, setNames] = useState<string[]>(["", "", ""]);
  const [lives, setLives] = useState(2);
  const [players, setPlayers] = useState<PartyPlayer[]>([]);
  const [phase, setPhase] = useState<Phase>({ status: "setup" });
  const party = useRef<string | null>(null);
  const roundNumber = useRef(0);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const fresh = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  };

  const fail = useCallback((error: unknown, retry: () => void) => {
    setPhase({
      status: "error",
      message: error instanceof ApiError ? error.message : playErrorMessage(error),
      retry,
    });
  }, []);

  /** Deals the next round, starting with `holder`. */
  const deal = useCallback(
    (holder: number) => {
      const partyId = party.current;
      if (!partyId) return;
      if (roundNumber.current >= PARTY_MAX_ROUNDS) {
        setPhase({ status: "over" });
        return;
      }
      const signal = fresh();
      setPhase({ status: "starting" });
      dealRound(partyId, roundNumber.current, signal)
        .then((round) => {
          if (signal.aborted) return;
          const now = Date.now();
          setPhase({
            status: "playing",
            round,
            holder,
            fuseAt: now + fuseLength(),
            startedAt: now,
            note: null,
          });
        })
        .catch((error: unknown) => {
          if (!signal.aborted) fail(error, () => deal(holder));
        });
    },
    [fail],
  );

  const begin = (table: string[]) => {
    const signal = fresh();
    setPlayers(newPlayers(table, lives));
    setPhase({ status: "starting" });
    roundNumber.current = 0;
    startParty(table.length, signal)
      .then((partyId) => {
        if (signal.aborted) return;
        party.current = partyId;
        deal(0);
      })
      .catch((error: unknown) => {
        if (!signal.aborted) fail(error, () => begin(table));
      });
  };

  const exploded = useCallback((round: PartyRound, victim: number) => {
    setPlayers((current) => boom(current, victim));
    setPhase({ status: "boom", round, victim });
  }, []);

  const nextRound = () => {
    if (phase.status !== "boom") return;
    roundNumber.current += 1;
    if (alive(players).length <= 1) {
      setPhase({ status: "over" });
      return;
    }
    // The player after the one who just lost a life starts (or they do, if still in).
    const starter =
      players[phase.victim]!.lives > 0 ? phase.victim : nextAlive(players, phase.victim);
    deal(starter);
  };

  switch (phase.status) {
    case "setup":
      return (
        <Setup
          names={names}
          setNames={setNames}
          lives={lives}
          setLives={setLives}
          onStart={() => begin(tidyNames(names, (n) => t("Player {n}", { n })))}
          onExit={onExit}
        />
      );
    case "starting":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="size-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">{t("Lighting the fuse…")}</p>
        </div>
      );
    case "playing":
      return (
        <Round
          key={phase.round.round}
          phase={phase}
          players={players}
          partyId={party.current!}
          onPhase={(update) =>
            setPhase((current) => (current.status === "playing" ? update(current) : current))
          }
          onScored={(player, points) => setPlayers((current) => scored(current, player, points))}
          onBoom={exploded}
        />
      );
    case "boom":
      return (
        <Boom
          round={phase.round}
          victim={phase.victim}
          players={players}
          last={alive(players).length <= 1}
          onNext={nextRound}
        />
      );
    case "over":
      return (
        <Over
          players={players}
          onAgain={() => begin(players.map((player) => player.name))}
          onNewTable={() => setPhase({ status: "setup" })}
          onExit={onExit}
        />
      );
    case "error":
      return (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <TriangleAlert className="size-6 text-destructive" />
          <p className="max-w-sm text-sm">{phase.message}</p>
          <div className="flex gap-2">
            <Button onClick={phase.retry}>{t("Try again")}</Button>
            <Button variant="ghost" onClick={onExit}>
              {t("Back")}
            </Button>
          </div>
        </div>
      );
  }
}

// ── Setting the table ───────────────────────────────────────────────────────

function Setup({
  names,
  setNames,
  lives,
  setLives,
  onStart,
  onExit,
}: {
  names: string[];
  setNames: (names: string[]) => void;
  lives: number;
  setLives: (lives: number) => void;
  onStart: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <form
        className="enter m-auto flex w-full max-w-sm flex-col gap-4 py-4"
        onSubmit={(event) => {
          event.preventDefault();
          onStart();
        }}
      >
        <div className="space-y-2 text-center">
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-surface-2">
            <Bomb className="size-5 text-muted-foreground" />
          </div>
          <h1 className="text-2xl font-semibold">{t("Hot potato")}</h1>
          <p className="text-sm text-muted-foreground">
            {t(
              "One phone, passed round the table. Name a correct answer nobody has said this round, then pass it on. A hidden fuse is burning: whoever's holding the phone when it goes off loses a life.",
            )}
          </p>
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 flex items-center gap-1.5 text-sm font-medium">
            <Users className="size-4" aria-hidden /> {t("Players")}
          </legend>
          {names.map((name, index) => (
            <div key={index} className="flex gap-2">
              <input
                value={name}
                maxLength={20}
                onChange={(event) =>
                  setNames(names.map((value, at) => (at === index ? event.target.value : value)))
                }
                placeholder={t("Player {n}", { n: index + 1 })}
                aria-label={t("Name of player {n}", { n: index + 1 })}
                autoComplete="off"
                className="h-11 min-w-0 flex-1 rounded-xl border border-input bg-surface px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {names.length > PARTY_MIN_PLAYERS && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t("Remove player {n}", { n: index + 1 })}
                  onClick={() => setNames(names.filter((_, at) => at !== index))}
                >
                  <Minus />
                </Button>
              )}
            </div>
          ))}
          {names.length < PARTY_MAX_PLAYERS && (
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => setNames([...names, ""])}
            >
              <Plus /> {t("Add a player")}
            </Button>
          )}
        </fieldset>

        <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Heart className="size-4" aria-hidden /> {t("Lives each")}
          </span>
          <div className="flex items-center gap-1" role="group" aria-label={t("Lives each")}>
            {[1, 2, 3].map((count) => (
              <Button
                key={count}
                type="button"
                size="sm"
                variant={lives === count ? "default" : "ghost"}
                aria-pressed={lives === count}
                onClick={() => setLives(count)}
              >
                {count}
              </Button>
            ))}
          </div>
        </div>

        <Button type="submit" variant="play" size="lg">
          {t("Light the fuse")}
        </Button>
        <Button type="button" variant="ghost" onClick={onExit}>
          {t("Back")}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          {t("Unranked. Names stay on this phone.")}
        </p>
      </form>
    </div>
  );
}

// ── A round ─────────────────────────────────────────────────────────────────

type Playing = Extract<Phase, { status: "playing" }>;

function Round({
  phase,
  players,
  partyId,
  onPhase,
  onScored,
  onBoom,
}: {
  phase: Playing;
  players: PartyPlayer[];
  partyId: string;
  onPhase: (update: (current: Playing) => Playing) => void;
  onScored: (player: number, points: number) => void;
  onBoom: (round: PartyRound, victim: number) => void;
}) {
  const [answer, setAnswer] = useState("");
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The latest phase and in-flight flag, for the fuse's timer.
  const latest = useRef(phase);
  latest.current = phase;
  const inFlight = useRef(false);
  const fuseWent = useRef(false);
  const elapsed = useElapsed(phase.startedAt);

  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, [phase.holder]);

  // The fuse. An answer already with the server when it goes off is judged first:
  // if it passes the phone on, the next player is holding it.
  useEffect(() => {
    const timer = window.setTimeout(
      () => {
        fuseWent.current = true;
        if (!inFlight.current) onBoom(latest.current.round, latest.current.holder);
      },
      Math.max(0, phase.fuseAt - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [phase.fuseAt, onBoom]);

  const send = async (value: string = answer) => {
    const typed = value.trim();
    if (!typed || sending) return;
    const holder = latest.current.holder;
    setSending(true);
    inFlight.current = true;
    let verdict: PartyVerdict;
    try {
      verdict = await answerRound(partyId, phase.round.round, holder, typed);
    } catch {
      verdict = { result: "unknown" };
    }
    inFlight.current = false;
    setSending(false);

    if (verdict.result === "valid") {
      onScored(holder, verdict.points);
      const next = nextAlive(players, holder);
      const round: PartyRound = {
        ...latest.current.round,
        used: [
          ...latest.current.round.used,
          { player: holder, canonical: verdict.canonical, tier: verdict.tier },
        ],
      };
      setAnswer("");
      onPhase((current) => ({
        ...current,
        holder: next,
        round,
        note: {
          kind: "passed",
          by: players[holder]!.name,
          canonical: verdict.canonical,
          tier: verdict.tier,
          points: verdict.points,
        },
      }));
      if (fuseWent.current) onBoom(round, next);
      return;
    }

    onPhase((current) => ({
      ...current,
      note: {
        kind: "refused",
        text:
          verdict.result === "repeat"
            ? t("Already said: {answer}. Try another.", { answer: verdict.canonical })
            : t(REFUSALS[verdict.result]),
        suggestions: verdict.result === "repeat" ? [] : (verdict.suggestions ?? []).slice(0, 2),
      },
    }));
    requestAnimationFrame(() => input.current?.select());
    if (fuseWent.current) onBoom(latest.current.round, holder);
  };

  const holder = players[phase.holder]!;
  // The potato pulses faster as the round goes on — by time burned, never by time
  // left, so the fuse stays a secret.
  const pulse = Math.max(0.35, 1.2 - elapsed / 30_000);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Lives players={players} holder={phase.holder} />
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center gap-5 py-4">
        <div
          className="deep-cut-potato flex size-20 items-center justify-center rounded-full bg-[oklch(0.72_0.14_60)] text-4xl shadow-lg"
          style={{ animationDuration: `${pulse}s` }}
          aria-hidden
        >
          🥔
        </div>
        <p className="text-lg font-semibold" aria-live="assertive">
          {t("{name}, it's yours!", { name: holder.name })}
        </p>
        <div className="space-y-1 text-center">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {t("Round {n}", { n: phase.round.round + 1 })} · {t(phase.round.category)}
          </p>
          <h2 className="text-balance text-2xl font-semibold leading-tight">
            {phase.round.prompt}
          </h2>
        </div>

        <form
          className="flex w-full flex-col gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <div className="flex gap-2">
            <input
              ref={input}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              readOnly={sending}
              maxLength={60}
              placeholder={t("Your answer")}
              aria-label={t("Answer for {name}", { name: holder.name })}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
              className="h-12 min-w-0 flex-1 rounded-xl border border-input bg-surface px-4 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button
              type="submit"
              variant="play"
              size="lg"
              className="h-12 px-4"
              disabled={sending || !answer.trim()}
              aria-label={t("Submit answer")}
            >
              {sending ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
            </Button>
          </div>
          <div className="min-h-10 text-center text-sm" aria-live="polite">
            {phase.note?.kind === "refused" && (
              <p
                className="flex items-center justify-center gap-1.5 font-medium text-destructive"
                role="alert"
              >
                <TriangleAlert className="size-4 shrink-0" aria-hidden />
                {phase.note.text}
              </p>
            )}
            {phase.note?.kind === "refused" && phase.note.suggestions.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
                <span className="text-muted-foreground">{t("Did you mean:")}</span>
                {phase.note.suggestions.map((suggestion) => (
                  <Button
                    key={suggestion}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="h-8 rounded-full"
                    disabled={sending}
                    onClick={() => {
                      setAnswer(suggestion);
                      void send(suggestion);
                    }}
                  >
                    {suggestion}
                  </Button>
                ))}
              </div>
            )}
            {phase.note?.kind === "passed" && (
              <p className="text-muted-foreground">
                {t("{name} said {answer}", { name: phase.note.by, answer: phase.note.canonical })} ·{" "}
                {t(tierInfo(phase.note.tier)?.name ?? "")} +{phase.note.points}
              </p>
            )}
          </div>
        </form>

        {phase.round.used.length > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            {t("Said so far:")} {phase.round.used.map((entry) => entry.canonical).join(", ")}
          </p>
        )}
      </div>
    </div>
  );
}

/** Milliseconds since `start`, ticking. */
function useElapsed(start: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  return Math.max(0, now - start);
}

/** The table across the top: names, hearts and who's holding it. */
function Lives({ players, holder }: { players: PartyPlayer[]; holder: number | null }) {
  return (
    <ul
      className="mx-auto flex w-full max-w-md flex-wrap justify-center gap-1.5 pt-3"
      aria-label={t("Players")}
    >
      {players.map((player, index) => (
        <li
          key={index}
          className={cn(
            "flex items-center gap-1 rounded-full px-2.5 py-1 text-xs",
            index === holder ? "bg-foreground text-background" : "bg-surface-2",
            player.lives === 0 && "opacity-40 line-through",
          )}
        >
          <span className="max-w-24 truncate font-medium">{player.name}</span>
          <span aria-label={t("{n} lives", { n: player.lives })}>
            {"♥".repeat(player.lives) || "✕"}
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── Between rounds ──────────────────────────────────────────────────────────

function Boom({
  round,
  victim,
  players,
  last,
  onNext,
}: {
  round: PartyRound;
  victim: number;
  players: PartyPlayer[];
  last: boolean;
  onNext: () => void;
}) {
  const player = players[victim]!;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <Lives players={players} holder={null} />
      <div className="enter m-auto flex w-full max-w-sm flex-col items-center gap-4 py-4 text-center">
        <div className="text-5xl" aria-hidden>
          💥
        </div>
        <h2 className="text-2xl font-semibold">
          {player.lives === 0
            ? t("{name} is out!", { name: player.name })
            : t("{name} loses a life!", { name: player.name })}
        </h2>
        <p className="text-sm text-muted-foreground">{round.prompt}</p>
        {round.used.length > 0 ? (
          <ul className="w-full space-y-1 text-left text-sm">
            {round.used.map((entry, index) => (
              <li
                key={index}
                className="flex justify-between gap-2 rounded-lg bg-surface-2 px-3 py-1.5"
              >
                <span className="truncate">
                  {entry.canonical}{" "}
                  <span className="text-muted-foreground">· {players[entry.player]?.name}</span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {t(tierInfo(entry.tier)?.name ?? "")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">{t("Nobody got one in.")}</p>
        )}
        <Button variant="play" size="lg" className="w-full" onClick={onNext} autoFocus>
          {last ? t("See who won") : t("Next round")}
        </Button>
      </div>
    </div>
  );
}

function Over({
  players,
  onAgain,
  onNewTable,
  onExit,
}: {
  players: PartyPlayer[];
  onAgain: () => void;
  onNewTable: () => void;
  onExit: () => void;
}) {
  const order = standings(players);
  const winner = order[0]!.player;
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="enter m-auto flex w-full max-w-sm flex-col items-center gap-4 py-4 text-center">
        <PartyPopper className="size-8 text-muted-foreground" aria-hidden />
        <h2 className="text-2xl font-semibold">{t("{name} wins!", { name: winner.name })}</h2>
        <ol className="w-full space-y-1 text-left text-sm">
          {order.map(({ index, player }, place) => (
            <li
              key={index}
              className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2"
            >
              <span className="truncate">
                <span className="mr-2 tabular text-muted-foreground">{place + 1}</span>
                {player.name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {player.answers === 1 ? t("1 answer") : t("{n} answers", { n: player.answers })} ·{" "}
                {t("{n} pts", { n: player.points })}
              </span>
            </li>
          ))}
        </ol>
        <div className="flex w-full flex-col gap-2">
          <Button variant="play" size="lg" onClick={onAgain}>
            <RotateCcw /> {t("Play again")}
          </Button>
          <Button variant="secondary" size="lg" onClick={onNewTable}>
            {t("New players")}
          </Button>
          <Button variant="ghost" onClick={onExit}>
            {t("Back")}
          </Button>
        </div>
      </div>
    </div>
  );
}
