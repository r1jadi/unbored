/**
 * One hook for the daily games whose run is a short list of moves on the day's
 * board — Ton Up, Ballpark, Only Once and Tee Time — from Start to a verified
 * score.
 *
 * It is `useGuessworkRun` with the game taken out: the session is issued on Start
 * with the player's day as its seed (the server picks it, as for the crossword),
 * the game builds its run from that session, every move is the game's own pure
 * step, and a run that has ended is submitted once. A signed-in player who has
 * played today is told so by the server (`already_played`, a 409).
 *
 * Storage rule: nothing here is persisted. A score only exists once the server has
 * verified it.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import {
  completeRun,
  startSession,
  type PlaySession,
  type RunResult,
  type RunSubmission,
} from "@/lib/games/sessions";
import { hasUnlimited, type PlayMode } from "@/lib/games/unlimited";
import { t } from "@/lib/settings/language";

/** What a daily game tells the hook about its runs. */
export type DailyEngine<R> = {
  /** The rules version a run is started under. */
  readonly rulesVersion: string;
  /** The day's run, built from the session the server issued. */
  readonly create: (session: PlaySession) => R | Promise<R>;
  /** Whether the run has ended and should be submitted. */
  readonly over: (run: R) => boolean;
  /** The run as the server replays it. */
  readonly submission: (run: R) => RunSubmission;
};

export type DailyRunState<R> =
  /** The rules are showing. No session exists yet: it is issued on Start. */
  | { status: "intro" }
  | { status: "starting" }
  | { status: "playing"; session: PlaySession; run: R }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: R }
  | { status: "finished"; session: PlaySession; run: R; result: RunResult }
  | {
      status: "error";
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: R;
    };

export type DailyRunControls<R> = DailyRunState<R> & {
  /** Whether a run started now would be ranked: the player is signed in. */
  signedIn: boolean;
  /** Whether the game has an Unlimited mode (`lib/games/unlimited.ts`). */
  unlimited: boolean;
  /**
   * Presses Start: asks the server for today's session. With "unlimited", deals an
   * Unlimited round instead: practice on a board other than today's.
   */
  begin: (mode?: PlayMode) => void;
  /**
   * Applies one of the game's steps to the live run. A step that returns the same
   * run object changed nothing and is ignored.
   */
  play: (step: (run: R) => R) => void;
  /** Back to the rules. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(t("Something went wrong. Please try again."));
}

export function useDailyRun<R>(
  gameSlug: string,
  engine: DailyEngine<R>,
  autoStart = false,
): DailyRunControls<R> {
  const [attempt, setAttempt] = useState(autoStart ? 1 : 0);
  const [state, setState] = useState<DailyRunState<R>>(
    autoStart ? { status: "starting" } : { status: "intro" },
  );
  const startedAt = useRef(0);
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const mode = useRef<PlayMode>("daily");
  // The engine is a module constant; a ref keeps the effects from depending on it.
  const engineRef = useRef(engine);
  engineRef.current = engine;
  const signedIn = !!getAccessToken();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (attempt === 0) return;
    const controller = new AbortController();
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, {
      signal: controller.signal,
      rulesVersion: engineRef.current.rulesVersion,
      unlimited: mode.current === "unlimited",
    })
      .then((session) =>
        Promise.resolve(engineRef.current.create(session)).then((run) => ({ session, run })),
      )
      .then(({ session, run }) => {
        if (controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification: once, when a run has ended.
  useEffect(() => {
    if (state.status !== "playing" || !engineRef.current.over(state.run)) return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...engineRef.current.submission(run), rulesVersion: session.rulesVersion },
      durationMs,
    )
      .then((result) => {
        if (!mounted.current) return;
        setState({ status: "finished", session, run, result });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        setState({ status: "error", stage: "submit", error: asApiError(error), session, run });
      })
      .finally(() => {
        submitting.current = false;
      });
  }, [state]);

  const play = useCallback((step: (run: R) => R) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = step(current.run);
      if (next === current.run) return current;
      if (engineRef.current.over(next)) endedAt.current = Date.now();
      return { ...current, run: next };
    });
  }, []);

  const begin = useCallback((next: PlayMode = "daily") => {
    mode.current = next;
    setAttempt((n) => n + 1);
  }, []);

  const restart = useCallback(() => {
    submitting.current = false;
    setState({ status: "intro" });
  }, []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;
    if (state.stage === "submit" && state.session && state.run !== undefined) {
      // The identical submission, sent again.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }
    setAttempt((n) => n + 1);
  }, [state]);

  const unlimited = hasUnlimited(engine.rulesVersion);

  return { ...state, signedIn, unlimited, begin, play, restart, retry };
}
