/**
 * A Deep Cut run, from the mode picker to the result: the lifecycle the screen is a
 * view onto. Nothing here decides a score — every number comes from the server —
 * and nothing is stored on the device.
 *
 *   intro → starting → question ⇄ answering → reveal → … → finishing → finished
 *
 * The daily run is a play session like every game's: started on Start, completed
 * through `completeRun` with the turns' answer ids. A signed-in player who reloads
 * mid-run continues it — the server hands back the questions already answered
 * (`settled`), so the run picks up at the first open one, clock still running.
 * Unlimited and Archive are practice runs with no session, totalled on the server.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import {
  answerQuestion,
  checkAnswer,
  DEEP_CUT_QUESTIONS,
  DEEP_CUT_RULES_VERSION,
  deepCutSubmission,
  finishPractice,
  revealQuestion,
  startPractice,
  type Check,
  type DeepCutMode,
  type DeepCutQuestion,
  type DeepCutTurn,
  type PlayedTurn,
} from "@/lib/games/deep-cut";
import { isOfflineSession } from "@/lib/games/offline";
import { completeRun, startSession, type RunResult } from "@/lib/games/sessions";
import { t } from "@/lib/settings/language";

export type DeepCutState =
  | { status: "intro" }
  | { status: "starting"; mode: DeepCutMode }
  /** A question is live: its clock runs until `deadline` (device time). */
  | {
      status: "question";
      mode: DeepCutMode;
      question: DeepCutQuestion;
      deadline: number;
      turns: PlayedTurn[];
    }
  /** An answer is with the server (and perhaps the judge). */
  | {
      status: "answering";
      mode: DeepCutMode;
      question: DeepCutQuestion;
      deadline: number;
      turns: PlayedTurn[];
      answer: string;
    }
  /** The answer's verdict, shown before the next question. */
  | { status: "reveal"; mode: DeepCutMode; question: DeepCutQuestion; turns: PlayedTurn[] }
  | { status: "finishing"; mode: DeepCutMode; turns: PlayedTurn[] }
  | {
      status: "finished";
      mode: DeepCutMode;
      turns: PlayedTurn[];
      /** Shown points (10–700). */
      points: number;
      /** The verified daily result; null for practice. */
      result: RunResult | null;
      sessionId: string | null;
      day: number | null;
    }
  /** Today's daily is done: the server said so. */
  | { status: "played" }
  | {
      status: "error";
      mode: DeepCutMode;
      stage: "start" | "play" | "finish";
      error: ApiError;
      turns: PlayedTurn[];
    };

export type DeepCutControls = DeepCutState & {
  signedIn: boolean;
  /** Starts a run. `day` is the archive's day. */
  begin: (mode: DeepCutMode, day?: number) => void;
  /** Answers the live question. An empty answer skips it. */
  submit: (answer: string) => void;
  /**
   * Asks whether an answer to the live question would count, without submitting
   * it. A failed check resolves `unknown`, so the player can still submit.
   */
  check: (answer: string) => Promise<Check>;
  /** Moves on from a verdict to the next question (or the result). */
  next: () => void;
  /** Ends the run now: the open question is skipped and the run is scored. */
  end: () => void;
  /** Back to the mode picker. */
  restart: () => void;
  /** Retries whichever step failed. */
  retry: () => void;
};

type Run = {
  mode: DeepCutMode;
  runId: string;
  /** The daily run's session; null for practice. */
  sessionId: string | null;
  startedAt: number;
  day: number | null;
};

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError(t("Something went wrong. Please try again."));
}

function played(turn: DeepCutTurn, question: DeepCutQuestion): PlayedTurn {
  return { ...turn, prompt: question.prompt, category: question.category };
}

export function useDeepCutRun(gameSlug: string): DeepCutControls {
  const [state, setState] = useState<DeepCutState>({ status: "intro" });
  // The state as of the last render, for handlers that act on it: their side
  // effects must not run inside a state updater, which React may call twice.
  const latest = useRef(state);
  latest.current = state;
  const run = useRef<Run | null>(null);
  const controller = useRef<AbortController | null>(null);
  const lastBegin = useRef<{ mode: DeepCutMode; day?: number } | null>(null);
  const signedIn = !!getAccessToken();

  useEffect(() => () => controller.current?.abort(), []);

  const fresh = () => {
    controller.current?.abort();
    controller.current = new AbortController();
    return controller.current.signal;
  };

  /** Deals question `position`, skipping past any the server says are answered. */
  const deal = useCallback(async (position: number, turns: PlayedTurn[], signal: AbortSignal) => {
    const current = run.current;
    if (!current) return;
    let at = position;
    let soFar = turns;
    while (at < DEEP_CUT_QUESTIONS) {
      const question = await revealQuestion(current.runId, at, signal);
      if (signal.aborted) return;
      if (!question.settled) {
        setState({
          status: "question",
          mode: current.mode,
          question,
          deadline: Date.now() + question.remainingMs,
          turns: soFar,
        });
        return;
      }
      soFar = [...soFar, played(question.settled, question)];
      at += 1;
    }
    // Every question was already answered: straight to the result.
    setState({ status: "finishing", mode: current.mode, turns: soFar });
  }, []);

  const begin = useCallback(
    (mode: DeepCutMode, day?: number) => {
      lastBegin.current = { mode, day };
      const signal = fresh();
      setState({ status: "starting", mode });
      (async () => {
        if (mode === "daily") {
          const session = await startSession(gameSlug, {
            signal,
            rulesVersion: DEEP_CUT_RULES_VERSION,
          });
          if (isOfflineSession(session.id)) {
            throw new ApiError(t("Deep Cut needs a connection: the answers live on our server."));
          }
          run.current = {
            mode,
            runId: session.id,
            sessionId: session.id,
            startedAt: Date.now(),
            day: Number(session.seed),
          };
        } else {
          const started = await startPractice(mode, day ?? null, signal);
          run.current = {
            mode,
            runId: started.runId,
            sessionId: null,
            startedAt: Date.now(),
            day: mode === "archive" ? (day ?? null) : null,
          };
        }
        await deal(0, [], signal);
      })().catch((error: unknown) => {
        if (signal.aborted) return;
        const apiError = asApiError(error);
        if (mode === "daily" && apiError.status === 409) {
          setState({ status: "played" });
          return;
        }
        setState({ status: "error", mode, stage: "start", error: apiError, turns: [] });
      });
    },
    [gameSlug, deal],
  );

  const submit = useCallback((answer: string) => {
    const current = latest.current;
    if (current.status !== "question" || !run.current) return;
    const { question, turns, mode, deadline } = current;
    const signal = fresh();
    setState({ status: "answering", mode, question, deadline, turns, answer });
    answerQuestion(run.current.runId, question.position, answer.slice(0, 60), signal)
      .then((turn) => {
        if (signal.aborted) return;
        setState({ status: "reveal", mode, question, turns: [...turns, played(turn, question)] });
      })
      .catch((error: unknown) => {
        if (signal.aborted) return;
        setState({ status: "error", mode, stage: "play", error: asApiError(error), turns });
      });
  }, []);

  const check = useCallback(async (answer: string): Promise<Check> => {
    const current = latest.current;
    if (current.status !== "question" || !run.current)
      return { result: "unknown", suggestions: [] };
    try {
      return await checkAnswer(
        run.current.runId,
        current.question.position,
        answer.slice(0, 60),
        controller.current?.signal,
      );
    } catch {
      return { result: "unknown", suggestions: [] };
    }
  }, []);

  const finish = useCallback((turns: PlayedTurn[], open: boolean) => {
    const current = run.current;
    if (!current) return;
    const signal = fresh();
    setState({ status: "finishing", mode: current.mode, turns });
    const done = (points: number, result: RunResult | null, settled: PlayedTurn[]) =>
      setState({
        status: "finished",
        mode: current.mode,
        turns: settled,
        points,
        result,
        sessionId: current.sessionId,
        day: current.day,
      });

    (async () => {
      if (current.sessionId) {
        const body = deepCutSubmission(turns, open);
        const durationMs = Math.max(1, Date.now() - current.startedAt);
        const result = await completeRun(current.sessionId, body, durationMs, { signal });
        if (signal.aborted) return;
        done(result.score * 10, result, turns);
      } else {
        const summary = await finishPractice(current.runId, signal);
        if (signal.aborted) return;
        // The server's totals; keep the prompts this screen already has.
        const merged = summary.turns.map((turn) => {
          const known = turns.find((mine) => mine.position === turn.position);
          return { ...turn, prompt: known?.prompt ?? "", category: known?.category ?? "" };
        });
        done(summary.points, null, merged);
      }
    })().catch((error: unknown) => {
      if (signal.aborted) return;
      setState({
        status: "error",
        mode: current.mode,
        stage: "finish",
        error: asApiError(error),
        turns,
      });
    });
  }, []);

  const next = useCallback(() => {
    const current = latest.current;
    if (current.status !== "reveal") return;
    const nextPosition = current.question.position + 1;
    if (nextPosition >= DEEP_CUT_QUESTIONS) {
      finish(current.turns, false);
      return;
    }
    const signal = fresh();
    setState({ status: "starting", mode: current.mode });
    deal(nextPosition, current.turns, signal).catch((error: unknown) => {
      if (signal.aborted) return;
      setState({
        status: "error",
        mode: current.mode,
        stage: "play",
        error: asApiError(error),
        turns: current.turns,
      });
    });
  }, [deal, finish]);

  const end = useCallback(() => {
    const current = latest.current;
    if (current.status === "question") finish(current.turns, true);
    else if (current.status === "reveal") finish(current.turns, false);
  }, [finish]);

  const restart = useCallback(() => {
    controller.current?.abort();
    run.current = null;
    setState({ status: "intro" });
  }, []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;
    if (state.stage === "start" || !run.current) {
      const again = lastBegin.current;
      if (again) begin(again.mode, again.day);
      else setState({ status: "intro" });
      return;
    }
    if (state.stage === "finish") {
      finish(state.turns, false);
      return;
    }
    // Mid-run: deal the next open question again. A question answered just before
    // the failure comes back settled and is skipped past.
    const signal = fresh();
    setState({ status: "starting", mode: state.mode });
    const turns = state.turns;
    deal(turns.length, turns, signal).catch((error: unknown) => {
      if (signal.aborted) return;
      setState({
        status: "error",
        mode: state.mode,
        stage: "play",
        error: asApiError(error),
        turns,
      });
    });
  }, [state, begin, finish, deal]);

  return { ...state, signedIn, begin, submit, check, next, end, restart, retry };
}
