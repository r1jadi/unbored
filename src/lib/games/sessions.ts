/**
 * Play sessions, verified scores and the boards they produce.
 *
 * The API this talks to (`services/game-sessions`, mounted with the catalogue —
 * see `docs/deployment/vercel.md`):
 *
 *   - `POST /sessions` issues a run. The server picks the id and the seed, so the
 *     client cannot choose its own deck. Only a published, playable game can start
 *     one; anything else is a 404.
 *   - `POST /sessions/{id}/complete` submits a finished run. The score in the body
 *     is a *claim*: the server replays the action list from the session's seed,
 *     derives the score itself and compares. A disagreement is refused.
 *   - `GET /games/{slug}/leaderboard` reads the persisted ranking for one game.
 *
 * Three rules follow from that and are enforced here rather than in a screen:
 *
 *   - **Nothing declares a score saved until the server says so.** `useStack10Run`
 *     has no state in which a client-side number counts as recorded: it is
 *     `submitting` until the API answers, and the number it displays afterwards is
 *     the one the server returned.
 *   - **A retry is the same submission.** The body is derived from the run, and the
 *     server recognises a repeated submission as the run it already recorded, so a
 *     dropped connection costs nothing and can never score twice.
 *   - **The board is whatever the database ranked.** Entries, the caller's own
 *     standing and the empty case all come from one response; there is no local
 *     ranking and no fallback list.
 *
 * Storage rule: the run lives in memory. Nothing is written to `localStorage` or
 * `sessionStorage` — a token pair and a half-finished run are both things a page
 * should not leave behind on a shared machine.
 */

import { queryOptions, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError, apiFetch } from "@/lib/api/client";
import { getAccessToken, getSessionUserId } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query";
import { fetchSavedRun, useSaveProgress } from "@/lib/games/saved-runs";
import {
  createRun as createChainRun,
  finish as finishChainRun,
  submission as chainSubmission,
  CHAIN_RULES_VERSION,
  tap as tapPad,
  type ChainRun,
} from "@/lib/games/chain";
import {
  createRun as createColorMergeRun,
  finish as finishColorMergeRun,
  submission as colorMergeSubmission,
  COLOR_MERGE_RULES_VERSION,
  slide as slideColorMerge,
  type ColorMergeDirection,
  type ColorMergeRun,
} from "@/lib/games/color-merge";
import {
  createRun as createDontTouchRun,
  finish as finishDontTouchRun,
  miss as missDontTouchRow,
  submission as dontTouchSubmission,
  tap as tapDontTouchTile,
  DONT_TOUCH_RULES_VERSION,
  type DontTouchRun,
} from "@/lib/games/dont-touch";
import {
  answer as answerSevenSecond,
  createRun as createSevenSecondRun,
  finish as finishSevenSecondRun,
  submission as sevenSecondSubmission,
  SEVEN_SECOND_RULES_VERSION,
  type SevenSecondRun,
} from "@/lib/games/seven-second";
import {
  createRun as createMemoryFlashRun,
  finish as finishMemoryFlashRun,
  submission as memoryFlashSubmission,
  MEMORY_FLASH_RULES_VERSION,
  tap as tapCell,
  type MemoryFlashRun,
} from "@/lib/games/memory-flash";
import {
  createRun as createOneMoveRun,
  finish as finishOneMoveRun,
  submission as oneMoveSubmission,
  ONE_MOVE_RULES_VERSION,
  tap as tapOneMoveCell,
  type OneMoveRun,
} from "@/lib/games/one-move";
import {
  createRun as createQueensRun,
  finish as finishQueensRun,
  submission as queensSubmission,
  QUEENS_RULES_VERSION,
  tap as tapQueensCell,
  type QueensRun,
} from "@/lib/games/queens";
import {
  board as drawZipBoard,
  budgetMs as zipBudgetMs,
  createRun as createZipRun,
  finish as finishZipRun,
  move as moveZip,
  submission as zipSubmission,
  ZIP_RULES_VERSION,
  type ZipRun,
} from "@/lib/games/zip";
import {
  budgetMs as eightPuzzleBudgetMs,
  createRun as createEightPuzzleRun,
  finish as finishEightPuzzleRun,
  submission as eightPuzzleSubmission,
  tap as tapEightPuzzle,
  EIGHT_PUZZLE_RULES_VERSION,
  type EightPuzzleRun,
} from "@/lib/games/eight-puzzle";
import {
  createRun,
  finish as finishStack10Run,
  place as placeTile,
  submission,
  STACK10_RULES_VERSION,
  type Stack10Run,
} from "@/lib/games/stack10";

/** Routes implemented by `services/game-sessions` and the catalogue's boards. */
const Routes = {
  sessions: "/sessions",
  complete: (sessionId: string) => `/sessions/${encodeURIComponent(sessionId)}/complete`,
  board: (slug: string) => `/games/${encodeURIComponent(slug)}/leaderboard`,
} as const;

/** Who is playing. Recorded with the session; never used to identify the caller. */
const CLIENT = "web/1.0";

/** The contract's board paging and windows. */
export const DEFAULT_BOARD_SIZE = 20;
export type BoardScope = "global" | "friends";
export type BoardPeriod = "all" | "day" | "week";

/** An issued run, as `POST /sessions` answers with it. */
export type PlaySession = {
  id: string;
  gameSlug: string;
  /** The rules the run is played and verified under. */
  rulesVersion: string;
  /** A decimal string: the seed is a `bigint` and may exceed a JS safe integer. */
  seed: string;
  tileCount: number;
  startedAt: string;
  expiresAt: string;
  /** False for a guest run: played and verified, and never eligible for a score. */
  ranked: boolean;
};

/** A verified run, as `POST /sessions/{id}/complete` answers with it. */
export type RunResult = {
  sessionId: string;
  gameSlug: string;
  /** The server's own arithmetic. Not the number the client sent. */
  score: number;
  clearedColumns: number;
  tilesPlaced: number;
  durationMs: number;
  ranked: boolean;
  recordedAt: string;
  /** The player's best score for the game, or null for an unranked run. */
  personalBest: number | null;
  /** Their rank on the all-time board, or null for an unranked run. */
  rank: number | null;
  /** True when this submission was a retry of the run already recorded. */
  duplicate: boolean;
};

/** One row of a board. The caller's own row is returned separately, as `me`. */
export type LeaderboardEntry = {
  rank: number;
  username: string;
  score: number;
  achievedAt: string | null;
  plays: number;
};

/** The caller's own place on the board they asked for. */
export type Standing = {
  rank: number;
  score: number;
  achievedAt: string | null;
  plays: number;
};

export type Leaderboard = {
  gameSlug: string;
  scope: BoardScope;
  period: BoardPeriod;
  entries: LeaderboardEntry[];
  hasMore: boolean;
  /** Null for an anonymous caller, and for one with no scored run in the window. */
  me: Standing | null;
};

/** The submitted run: what the server replays. */
export type RunSubmission = {
  rulesVersion: string;
  actions: readonly number[];
  score: number;
};

type RequestOptions = { signal?: AbortSignal; rulesVersion?: string };

// ── Requests ────────────────────────────────────────────────────────────────

/**
 * Starts a run of one game.
 *
 * The token is attached when the caller has a session, which is what makes the run
 * ranked; without one the run is still real, still verified, and simply not
 * eligible for a score. The request carries no user id — the token is the identity.
 * The rules default to Stack 10's; every other runtime passes its own version,
 * which is what the server's start gate matches against the game's runtime.
 */
export function startSession(gameSlug: string, options: RequestOptions = {}): Promise<PlaySession> {
  const token = getAccessToken();
  return apiFetch<PlaySession>(Routes.sessions, {
    method: "POST",
    body: {
      gameSlug,
      rulesVersion: options.rulesVersion ?? STACK10_RULES_VERSION,
      client: CLIENT,
    },
    token,
    signal: options.signal,
  });
}

/**
 * Submits a finished run for verification.
 *
 * `durationMs` is measured by the player's own clock between the session arriving
 * and the run ending — a client-side delta, so a wrong system clock cannot make the
 * server see an impossible duration. The server still checks it against the age of
 * the session.
 */
export function completeRun(
  sessionId: string,
  submissionBody: RunSubmission,
  durationMs: number,
  options: RequestOptions = {},
): Promise<RunResult> {
  const token = getAccessToken();
  return postCompletion(sessionId, submissionBody, durationMs, token, options).then((result) => {
    // A verified run changes the game's board, its play count and the player's
    // own stats; the next visit to any of them should read them fresh.
    const client = getQueryClient();
    void client.invalidateQueries({ queryKey: ["leaderboard", result.gameSlug] });
    void client.invalidateQueries({ queryKey: ["leaderboard", "all-games"] });
    void client.invalidateQueries({ queryKey: ["games"] });
    void client.invalidateQueries({ queryKey: ["my-game-stats", result.gameSlug] });
    return result;
  });
}

function postCompletion(
  sessionId: string,
  submissionBody: RunSubmission,
  durationMs: number,
  token: string | undefined,
  options: RequestOptions,
): Promise<RunResult> {
  return apiFetch<RunResult>(Routes.complete(sessionId), {
    method: "POST",
    body: {
      score: submissionBody.score,
      durationMs,
      progress: {
        rulesVersion: submissionBody.rulesVersion,
        actions: [...submissionBody.actions],
      },
    },
    token,
    signal: options.signal,
    // The server recognises an identical resubmission as the run it already
    // recorded (`duplicate`), so a completion that hit a cold or restarting
    // gateway is safe to send again without asking the player.
    retryable: true,
  });
}

/**
 * Reads one game's persisted ranking.
 *
 * The period is turned into the same window the server would compute; the board is
 * public, and a token only adds the caller's own standing to the same response.
 */
export function fetchLeaderboard(
  gameSlug: string,
  query: { scope?: BoardScope; period?: BoardPeriod; limit?: number; offset?: number } = {},
  options: RequestOptions = {},
): Promise<Leaderboard> {
  const token = getAccessToken();
  return apiFetch<Leaderboard>(Routes.board(gameSlug), {
    query: {
      scope: query.scope,
      period: query.period,
      limit: query.limit,
      offset: query.offset,
    },
    token,
    signal: options.signal,
  });
}

/**
 * The message to show a person when a session or board call fails.
 *
 * The API writes messages that are safe to display — "That run expired before it
 * was submitted. Start a new one." — so they are passed through. Anything else is a
 * transport failure or a bug and gets a generic sentence rather than a detail.
 */
export function playErrorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : "Something went wrong. Please try again.";
}

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError("Something went wrong. Please try again.");
}

// ── A run of Stack 10, from session to score ────────────────────────────────

export type Stack10RunState =
  | { status: "starting" }
  /**
   * The player has an unfinished run of this game saved on their account. It is
   * offered before a new one is started: continue it, or start over.
   */
  | { status: "saved"; session: PlaySession; run: Stack10Run; playedMs: number }
  | { status: "playing"; session: PlaySession; run: Stack10Run }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: Stack10Run }
  | { status: "finished"; session: PlaySession; run: Stack10Run; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: Stack10Run;
    };

export type Stack10RunControls = Stack10RunState & {
  /** Continues the saved run, where it was left. */
  continueRun: () => void;
  /** Ends the saved run, keeping its score, and starts a new one. */
  newRun: () => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /** Places the run's next tile. Ignored unless the run is live. */
  place: (column: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Stack 10 against the session API.
 *
 * The lifecycle is a state machine with no shortcuts: a run exists only after the
 * server issued a session, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of zero.
 * A submission is attempted exactly once per run — the effect that triggers it is
 * guarded — so a re-render cannot send it twice, and a player who retries a failed
 * submission sends the identical body, which the server recognises.
 */
export function useStack10Run(gameSlug: string): Stack10RunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Stack10RunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  // Set by "New run": the next start skips the saved run and begins afresh.
  const skipSaved = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while a
    // session is issued would show a playable board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    // A signed-in player's unfinished run comes first: it is offered to continue
    // rather than replaced by a new session behind their back.
    const fresh = skipSaved.current;
    skipSaved.current = false;
    (fresh ? Promise.resolve(null) : fetchSavedRun(gameSlug, STACK10_RULES_VERSION))
      .then((saved) => {
        if (controller.signal.aborted) return null;
        if (saved) {
          const run = saved.actions.reduce(
            (current: Stack10Run, action) => placeTile(current, action),
            createRun(saved.session.seed),
          );
          setState({ status: "saved", session: saved.session, run, playedMs: saved.playedMs });
          return null;
        }
        return startSession(gameSlug, { signal: controller.signal });
      })
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run: createRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(session.id, { ...submission(run), rulesVersion: session.rulesVersion }, durationMs)
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

  const place = useCallback((column: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = placeTile(current.run, column);
      // An impossible move returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishStack10Run(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const continueRun = useCallback(() => {
    setState((current) => {
      if (current.status !== "saved") return current;
      // The run's clock carries on from the time it had already been played.
      startedAt.current = Date.now() - current.playedMs;
      return { status: "playing", session: current.session, run: current.run };
    });
  }, []);

  const newRun = useCallback(() => {
    if (state.status !== "saved") return;
    const { session, run, playedMs } = state;
    setState({ status: "starting" });
    // The saved run ends here and keeps its score, like any run the player ends:
    // it is submitted as it was left. Only then does the new run start, because
    // starting one closes the player's open session.
    completeRun(
      session.id,
      { ...submission(run), rulesVersion: session.rulesVersion },
      Math.max(1, playedMs),
    )
      .catch(() => undefined)
      .finally(() => {
        skipSaved.current = true;
        setAttempt((n) => n + 1);
      });
  }, [state]);

  // A signed-in player's live run is kept on their account as it is played.
  useSaveProgress(
    state.status === "playing" && state.run.outcome === "playing"
      ? { session: state.session, actions: state.run.actions }
      : null,
    startedAt,
  );

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, place, finish, restart, retry, continueRun, newRun };
}

// ── A run of Chain, from session to score ─────────────────────────────────

export type ChainRunState =
  | { status: "starting" }
  /**
   * The player has an unfinished run of this game saved on their account. It is
   * offered before a new one is started: continue it, or start over.
   */
  | { status: "saved"; session: PlaySession; run: ChainRun; playedMs: number }
  | { status: "playing"; session: PlaySession; run: ChainRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: ChainRun }
  | { status: "finished"; session: PlaySession; run: ChainRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: ChainRun;
    };

export type ChainRunControls = ChainRunState & {
  /** Continues the saved run, where it was left. */
  continueRun: () => void;
  /** Ends the saved run, keeping its score, and starts a new one. */
  newRun: () => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /** Taps a pad. Ignored unless the run is live. */
  tap: (pad: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Chain against the session API.
 *
 * The same lifecycle as `useStack10Run`, because the server treats every game
 * the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that
 * triggers it is guarded — so a re-render cannot send it twice, and a player
 * who retries a failed submission sends the identical body, which the server
 * recognises.
 */
export function useChainRun(gameSlug: string): ChainRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ChainRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  // Set by "New run": the next start skips the saved run and begins afresh.
  const skipSaved = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while a
    // session is issued would show playable pads with no session behind them.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    // A signed-in player's unfinished run comes first: it is offered to continue
    // rather than replaced by a new session behind their back.
    const fresh = skipSaved.current;
    skipSaved.current = false;
    (fresh ? Promise.resolve(null) : fetchSavedRun(gameSlug, CHAIN_RULES_VERSION))
      .then((saved) => {
        if (controller.signal.aborted) return null;
        if (saved) {
          const run = saved.actions.reduce(
            (current: ChainRun, action) => tapPad(current, action),
            createChainRun(saved.session.seed),
          );
          setState({ status: "saved", session: saved.session, run, playedMs: saved.playedMs });
          return null;
        }
        return startSession(gameSlug, {
          signal: controller.signal,
          rulesVersion: CHAIN_RULES_VERSION,
        });
      })
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run: createChainRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...chainSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((pad: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapPad(current.run, pad);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishChainRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const continueRun = useCallback(() => {
    setState((current) => {
      if (current.status !== "saved") return current;
      // The run's clock carries on from the time it had already been played.
      startedAt.current = Date.now() - current.playedMs;
      return { status: "playing", session: current.session, run: current.run };
    });
  }, []);

  const newRun = useCallback(() => {
    if (state.status !== "saved") return;
    const { session, run, playedMs } = state;
    setState({ status: "starting" });
    // The saved run ends here and keeps its score, like any run the player ends:
    // it is submitted as it was left. Only then does the new run start, because
    // starting one closes the player's open session.
    completeRun(
      session.id,
      { ...chainSubmission(run), rulesVersion: session.rulesVersion },
      Math.max(1, playedMs),
    )
      .catch(() => undefined)
      .finally(() => {
        skipSaved.current = true;
        setAttempt((n) => n + 1);
      });
  }, [state]);

  // A signed-in player's live run is kept on their account as it is played.
  useSaveProgress(
    state.status === "playing" && state.run.outcome === "playing"
      ? { session: state.session, actions: state.run.taps }
      : null,
    startedAt,
  );

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, tap, finish, restart, retry, continueRun, newRun };
}

// ── A run of Memory Flash, from session to score ───────────────────────────

export type MemoryFlashRunState =
  | { status: "starting" }
  /**
   * The player has an unfinished run of this game saved on their account. It is
   * offered before a new one is started: continue it, or start over.
   */
  | { status: "saved"; session: PlaySession; run: MemoryFlashRun; playedMs: number }
  | { status: "playing"; session: PlaySession; run: MemoryFlashRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: MemoryFlashRun }
  | { status: "finished"; session: PlaySession; run: MemoryFlashRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: MemoryFlashRun;
    };

export type MemoryFlashRunControls = MemoryFlashRunState & {
  /** Continues the saved run, where it was left. */
  continueRun: () => void;
  /** Ends the saved run, keeping its score, and starts a new one. */
  newRun: () => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /** Taps a cell. Ignored unless the run is live. */
  tap: (cell: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Memory Flash against the session API.
 *
 * The same lifecycle as `useStack10Run` and `useChainRun`, because the server
 * treats every game the same way: a run exists only after the server issued a
 * session under the game's own rules version, a result exists only after the
 * server verified the submission, and an error is reported as an error rather
 * than as a score of zero. A submission is attempted exactly once per run — the
 * effect that triggers it is guarded — so a re-render cannot send it twice, and a
 * player who retries a failed submission sends the identical body, which the
 * server recognises.
 */
export function useMemoryFlashRun(gameSlug: string): MemoryFlashRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<MemoryFlashRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  // Set by "New run": the next start skips the saved run and begins afresh.
  const skipSaved = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous pattern on screen while
    // a session is issued would show a board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    // A signed-in player's unfinished run comes first: it is offered to continue
    // rather than replaced by a new session behind their back.
    const fresh = skipSaved.current;
    skipSaved.current = false;
    (fresh ? Promise.resolve(null) : fetchSavedRun(gameSlug, MEMORY_FLASH_RULES_VERSION))
      .then((saved) => {
        if (controller.signal.aborted) return null;
        if (saved) {
          const run = saved.actions.reduce(
            (current: MemoryFlashRun, action) => tapCell(current, action),
            createMemoryFlashRun(saved.session.seed),
          );
          setState({ status: "saved", session: saved.session, run, playedMs: saved.playedMs });
          return null;
        }
        return startSession(gameSlug, {
          signal: controller.signal,
          rulesVersion: MEMORY_FLASH_RULES_VERSION,
        });
      })
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        startedAt.current = Date.now();
        setState({ status: "playing", session, run: createMemoryFlashRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...memoryFlashSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapCell(current.run, cell);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishMemoryFlashRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const continueRun = useCallback(() => {
    setState((current) => {
      if (current.status !== "saved") return current;
      // The run's clock carries on from the time it had already been played.
      startedAt.current = Date.now() - current.playedMs;
      return { status: "playing", session: current.session, run: current.run };
    });
  }, []);

  const newRun = useCallback(() => {
    if (state.status !== "saved") return;
    const { session, run, playedMs } = state;
    setState({ status: "starting" });
    // The saved run ends here and keeps its score, like any run the player ends:
    // it is submitted as it was left. Only then does the new run start, because
    // starting one closes the player's open session.
    completeRun(
      session.id,
      { ...memoryFlashSubmission(run), rulesVersion: session.rulesVersion },
      Math.max(1, playedMs),
    )
      .catch(() => undefined)
      .finally(() => {
        skipSaved.current = true;
        setAttempt((n) => n + 1);
      });
  }, [state]);

  // A signed-in player's live run is kept on their account as it is played.
  useSaveProgress(
    state.status === "playing" && state.run.outcome === "playing"
      ? { session: state.session, actions: state.run.taps }
      : null,
    startedAt,
  );

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, tap, finish, restart, retry, continueRun, newRun };
}

// ── A run of One Move, from session to score ───────────────────────────────

export type OneMoveRunState =
  | { status: "starting" }
  /**
   * The player has an unfinished run of this game saved on their account. It is
   * offered before a new one is started: continue it, or start over.
   */
  | { status: "saved"; session: PlaySession; run: OneMoveRun; playedMs: number }
  | { status: "playing"; session: PlaySession; run: OneMoveRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: OneMoveRun }
  | { status: "finished"; session: PlaySession; run: OneMoveRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: OneMoveRun;
    };

export type OneMoveRunControls = OneMoveRunState & {
  /** Continues the saved run, where it was left. */
  continueRun: () => void;
  /** Ends the saved run, keeping its score, and starts a new one. */
  newRun: () => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /**
   * Marks the moment the player pressed Start, so the submitted duration is the
   * run's and not the time spent reading the rules.
   */
  begin: () => void;
  /** Taps a cell. Ignored unless the run is live. */
  tap: (cell: number) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of One Move against the session API.
 *
 * The same lifecycle as the other three runtimes, because the server treats every
 * game the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that triggers
 * it is guarded — so a re-render cannot send it twice, and a player who retries a
 * failed submission sends the identical body, which the server recognises.
 */
export function useOneMoveRun(gameSlug: string): OneMoveRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<OneMoveRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  // Set by "New run": the next start skips the saved run and begins afresh.
  const skipSaved = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while a
    // session is issued would show a board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    // A signed-in player's unfinished run comes first: it is offered to continue
    // rather than replaced by a new session behind their back.
    const fresh = skipSaved.current;
    skipSaved.current = false;
    (fresh ? Promise.resolve(null) : fetchSavedRun(gameSlug, ONE_MOVE_RULES_VERSION))
      .then((saved) => {
        if (controller.signal.aborted) return null;
        if (saved) {
          const run = saved.actions.reduce(
            (current: OneMoveRun, action) => tapOneMoveCell(current, action),
            createOneMoveRun(saved.session.seed),
          );
          setState({ status: "saved", session: saved.session, run, playedMs: saved.playedMs });
          return null;
        }
        return startSession(gameSlug, {
          signal: controller.signal,
          rulesVersion: ONE_MOVE_RULES_VERSION,
        });
      })
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        // The clock starts when the player presses Start (`begin`), not when the
        // session arrives: reading the rules is not part of the run.
        setState({ status: "playing", session, run: createOneMoveRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    // Defensive: every run is begun before it can end, but a missing mark must
    // never turn into a duration measured from the epoch.
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...oneMoveSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapOneMoveCell(current.run, cell);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const begin = useCallback(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishOneMoveRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const continueRun = useCallback(() => {
    setState((current) => {
      if (current.status !== "saved") return current;
      // The run's clock carries on from the time it had already been played.
      startedAt.current = Date.now() - current.playedMs;
      return { status: "playing", session: current.session, run: current.run };
    });
  }, []);

  const newRun = useCallback(() => {
    if (state.status !== "saved") return;
    const { session, run, playedMs } = state;
    setState({ status: "starting" });
    // The saved run ends here and keeps its score, like any run the player ends:
    // it is submitted as it was left. Only then does the new run start, because
    // starting one closes the player's open session.
    completeRun(
      session.id,
      { ...oneMoveSubmission(run), rulesVersion: session.rulesVersion },
      Math.max(1, playedMs),
    )
      .catch(() => undefined)
      .finally(() => {
        skipSaved.current = true;
        setAttempt((n) => n + 1);
      });
  }, [state]);

  // A signed-in player's live run is kept on their account as it is played.
  useSaveProgress(
    state.status === "playing" && state.run.outcome === "playing"
      ? { session: state.session, actions: state.run.taps }
      : null,
    startedAt,
  );

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, begin, tap, finish, restart, retry, continueRun, newRun };
}

// ── A run of Queens, from session to score ───────────────────────────────

export type QueensRunState =
  | { status: "starting" }
  /**
   * The player has an unfinished run of this game saved on their account. It is
   * offered before a new one is started: continue it, or start over.
   */
  | { status: "saved"; session: PlaySession; run: QueensRun; playedMs: number }
  | { status: "playing"; session: PlaySession; run: QueensRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: QueensRun }
  | { status: "finished"; session: PlaySession; run: QueensRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: QueensRun;
    };

export type QueensRunControls = QueensRunState & {
  /** Continues the saved run, where it was left. */
  continueRun: () => void;
  /** Ends the saved run, keeping its score, and starts a new one. */
  newRun: () => void;
  /**
   * Marks the moment the player pressed Start, so the submitted duration is the
   * run's and not the time spent reading the rules.
   */
  begin: () => void;
  /** Taps a cell: empty, X, Queen, empty. Ignored unless the run is live. */
  tap: (cell: number) => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Queens against the session API.
 *
 * The same lifecycle as the other runtimes, because the server treats every
 * game the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that triggers
 * it is guarded — so a re-render cannot send it twice, and a player who retries a
 * failed submission sends the identical body, which the server recognises.
 */
export function useQueensRun(gameSlug: string): QueensRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<QueensRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  // Set by "New run": the next start skips the saved run and begins afresh.
  const skipSaved = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while a
    // session is issued would show a board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    // A signed-in player's unfinished run comes first: it is offered to continue
    // rather than replaced by a new session behind their back.
    const fresh = skipSaved.current;
    skipSaved.current = false;
    (fresh ? Promise.resolve(null) : fetchSavedRun(gameSlug, QUEENS_RULES_VERSION))
      .then((saved) => {
        if (controller.signal.aborted) return null;
        if (saved) {
          const run = saved.actions.reduce(
            (current: QueensRun, action) => tapQueensCell(current, action),
            createQueensRun(saved.session.seed),
          );
          setState({ status: "saved", session: saved.session, run, playedMs: saved.playedMs });
          return null;
        }
        return startSession(gameSlug, {
          signal: controller.signal,
          rulesVersion: QUEENS_RULES_VERSION,
        });
      })
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        // The clock starts when the player presses Start (`begin`), not when the
        // session arrives: reading the rules is not part of the run.
        setState({ status: "playing", session, run: createQueensRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    // Defensive: every run is begun before it can end, but a missing mark must
    // never turn into a duration measured from the epoch.
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...queensSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapQueensCell(current.run, cell);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishQueensRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const begin = useCallback(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
  }, []);

  const continueRun = useCallback(() => {
    setState((current) => {
      if (current.status !== "saved") return current;
      // The run's clock carries on from the time it had already been played.
      startedAt.current = Date.now() - current.playedMs;
      return { status: "playing", session: current.session, run: current.run };
    });
  }, []);

  const newRun = useCallback(() => {
    if (state.status !== "saved") return;
    const { session, run, playedMs } = state;
    setState({ status: "starting" });
    // The saved run ends here and keeps its score, like any run the player ends:
    // it is submitted as it was left. Only then does the new run start, because
    // starting one closes the player's open session.
    completeRun(
      session.id,
      { ...queensSubmission(run), rulesVersion: session.rulesVersion },
      Math.max(1, playedMs),
    )
      .catch(() => undefined)
      .finally(() => {
        skipSaved.current = true;
        setAttempt((n) => n + 1);
      });
  }, [state]);

  // A signed-in player's live run is kept on their account as it is played.
  useSaveProgress(
    state.status === "playing" && state.run.outcome === "playing"
      ? { session: state.session, actions: state.run.taps }
      : null,
    startedAt,
  );

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, begin, tap, finish, restart, retry, continueRun, newRun };
}

// ── A run of Zip, from Start to score ──────────────────────────────────────

export type ZipRunState =
  /** The rules are showing. No session exists yet: it is issued on Start. */
  | { status: "intro" }
  | { status: "starting" }
  | {
      status: "playing";
      session: PlaySession;
      run: ZipRun;
      /** When the clock runs out, as a `Date.now()` timestamp. */
      deadline: number;
    }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: ZipRun; deadline: number }
  | { status: "finished"; session: PlaySession; run: ZipRun; result: RunResult }
  | {
      status: "error";
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: ZipRun;
    };

export type ZipRunControls = ZipRunState & {
  /** Whether a run started now would be ranked: the player is signed in. */
  signedIn: boolean;
  /** Presses Start: asks the server for a session, and the clock starts when it arrives. */
  begin: () => void;
  /** Sends a cell. Ignored unless the run is live and the board allows the move. */
  tap: (cell: number) => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /** Back to the rules, for a fresh run. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Zip against the session API.
 *
 * Zip's session is not issued when the screen opens (8 Puzzle's neither): its run
 * is against a clock, and the verifier times that clock from the session's own
 * start (`out_of_time`). So the rules show first with no session behind them, and
 * Start is what asks for one. The clock starts when the session arrives, and the
 * run ends by itself when the clock reaches zero.
 *
 * The rest of the lifecycle is the other runtimes': a result exists only after
 * the server verified the submission, the submission is sent once per run, and a
 * retry sends the identical body.
 */
export function useZipRun(gameSlug: string, autoStart = false): ZipRunControls {
  // Tap to play skips the rules: the first render is already "starting", so the
  // rules never paint for a frame before an effect could press Start for them.
  const [attempt, setAttempt] = useState(autoStart ? 1 : 0);
  const [state, setState] = useState<ZipRunState>(
    autoStart ? { status: "starting" } : { status: "intro" },
  );
  const startedAt = useRef(0);
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const signedIn = !!getAccessToken();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A session is requested only once Start has been pressed (`attempt` > 0).
  useEffect(() => {
    if (attempt === 0) return;
    const controller = new AbortController();
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, { signal: controller.signal, rulesVersion: ZIP_RULES_VERSION })
      .then((session) => {
        if (controller.signal.aborted) return;
        const run = createZipRun(session.seed);
        startedAt.current = Date.now();
        setState({
          status: "playing",
          session,
          run,
          deadline: startedAt.current + zipBudgetMs(0),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // The clock. When it reaches zero the run is over, and verification follows.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome !== "playing") return;
    const remaining = state.deadline - Date.now();
    const timer = setTimeout(
      () => {
        setState((current) => {
          if (current.status !== "playing" || current.run.outcome !== "playing") return current;
          if (Date.now() < current.deadline) return { ...current };
          endedAt.current = current.deadline;
          return { ...current, run: finishZipRun(current.run, "time") };
        });
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [state]);

  // Verification: once, when a run has ended.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run, deadline } = state;
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run, deadline });

    completeRun(
      session.id,
      { ...zipSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      // A tap after the deadline — a backgrounded tab can hold its timer back —
      // ends the run instead of moving: the clock has already run out.
      if (Date.now() >= current.deadline) {
        if (current.run.outcome !== "playing") return current;
        endedAt.current = current.deadline;
        return { ...current, run: finishZipRun(current.run, "time") };
      }
      const drawn = drawZipBoard(current.run.seed, current.run.level);
      const next = moveZip(current.run, drawn, cell);
      if (next === current.run) return current;
      // A solved board buys time: the deadline follows the boards solved.
      return {
        ...current,
        run: next,
        deadline: startedAt.current + zipBudgetMs(next.levelsCleared),
      };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishZipRun(current.run, "stopped");
      if (next === current.run) return current;
      endedAt.current = Date.now();
      return { ...current, run: next };
    });
  }, []);

  const begin = useCallback(() => setAttempt((n) => n + 1), []);

  const restart = useCallback(() => {
    submitting.current = false;
    // Tap to play skips the rules on Play again too: straight to a new session.
    if (autoStart) {
      setState({ status: "starting" });
      setAttempt((n) => n + 1);
    } else {
      setState({ status: "intro" });
    }
  }, [autoStart]);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The clock is already over, so the
      // deadline only has to exist; it no longer moves.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run, deadline: 0 });
      return;
    }

    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, signedIn, begin, tap, finish, restart, retry };
}

// ── A run of 8 Puzzle, from Start to score ──────────────────────────────────────

export type EightPuzzleRunState =
  /** The rules are showing. No session exists yet: it is issued on Start. */
  | { status: "intro" }
  | { status: "starting" }
  | {
      status: "playing";
      session: PlaySession;
      run: EightPuzzleRun;
      /** When the clock runs out, as a `Date.now()` timestamp. */
      deadline: number;
    }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: EightPuzzleRun; deadline: number }
  | { status: "finished"; session: PlaySession; run: EightPuzzleRun; result: RunResult }
  | {
      status: "error";
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: EightPuzzleRun;
    };

export type EightPuzzleRunControls = EightPuzzleRunState & {
  /** Whether a run started now would be ranked: the player is signed in. */
  signedIn: boolean;
  /** Presses Start: asks the server for a session, and the clock starts when it arrives. */
  begin: () => void;
  /** Slides the tile on a cell into the gap. Ignored unless the run is live and it can. */
  tap: (cell: number) => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /** Back to the rules, for a fresh run. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of 8 Puzzle against the session API.
 *
 * The same lifecycle as Zip, for the same reason: the run is against a clock the
 * verifier times from the session's start (`out_of_time`), so the session is
 * issued when the player presses Start, the clock starts when it arrives, and the
 * run ends by itself when the clock reaches zero.
 */
export function useEightPuzzleRun(gameSlug: string, autoStart = false): EightPuzzleRunControls {
  // Tap to play skips the rules: the first render is already "starting", so the
  // rules never paint for a frame before an effect could press Start for them.
  const [attempt, setAttempt] = useState(autoStart ? 1 : 0);
  const [state, setState] = useState<EightPuzzleRunState>(
    autoStart ? { status: "starting" } : { status: "intro" },
  );
  const startedAt = useRef(0);
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  const signedIn = !!getAccessToken();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // A session is requested only once Start has been pressed (`attempt` > 0).
  useEffect(() => {
    if (attempt === 0) return;
    const controller = new AbortController();
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, { signal: controller.signal, rulesVersion: EIGHT_PUZZLE_RULES_VERSION })
      .then((session) => {
        if (controller.signal.aborted) return;
        const run = createEightPuzzleRun(session.seed);
        startedAt.current = Date.now();
        setState({
          status: "playing",
          session,
          run,
          deadline: startedAt.current + eightPuzzleBudgetMs(0),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // The clock. When it reaches zero the run is over, and verification follows.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome !== "playing") return;
    const remaining = state.deadline - Date.now();
    const timer = setTimeout(
      () => {
        setState((current) => {
          if (current.status !== "playing" || current.run.outcome !== "playing") return current;
          if (Date.now() < current.deadline) return { ...current };
          endedAt.current = current.deadline;
          return { ...current, run: finishEightPuzzleRun(current.run, "time") };
        });
      },
      Math.max(0, remaining),
    );
    return () => clearTimeout(timer);
  }, [state]);

  // Verification: once, when a run has ended.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run, deadline } = state;
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run, deadline });

    completeRun(
      session.id,
      { ...eightPuzzleSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      // A tap after the deadline — a backgrounded tab can hold its timer back —
      // ends the run instead of moving: the clock has already run out.
      if (Date.now() >= current.deadline) {
        if (current.run.outcome !== "playing") return current;
        endedAt.current = current.deadline;
        return { ...current, run: finishEightPuzzleRun(current.run, "time") };
      }
      const next = tapEightPuzzle(current.run, cell);
      if (next === current.run) return current;
      // A solved board buys time: the deadline follows the boards solved.
      return {
        ...current,
        run: next,
        deadline: startedAt.current + eightPuzzleBudgetMs(next.levelsCleared),
      };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishEightPuzzleRun(current.run, "stopped");
      if (next === current.run) return current;
      endedAt.current = Date.now();
      return { ...current, run: next };
    });
  }, []);

  const begin = useCallback(() => setAttempt((n) => n + 1), []);

  const restart = useCallback(() => {
    submitting.current = false;
    // Tap to play skips the rules on Play again too: straight to a new session.
    if (autoStart) {
      setState({ status: "starting" });
      setAttempt((n) => n + 1);
    } else {
      setState({ status: "intro" });
    }
  }, [autoStart]);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The clock is already over, so the
      // deadline only has to exist; it no longer moves.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run, deadline: 0 });
      return;
    }

    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, signedIn, begin, tap, finish, restart, retry };
}

// ── A run of Color Merge, from session to score ────────────────────────────

export type ColorMergeRunState =
  | { status: "starting" }
  /**
   * The player has an unfinished run of this game saved on their account. It is
   * offered before a new one is started: continue it, or start over.
   */
  | { status: "saved"; session: PlaySession; run: ColorMergeRun; playedMs: number }
  | { status: "playing"; session: PlaySession; run: ColorMergeRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: ColorMergeRun }
  | { status: "finished"; session: PlaySession; run: ColorMergeRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: ColorMergeRun;
    };

export type ColorMergeRunControls = ColorMergeRunState & {
  /** Continues the saved run, where it was left. */
  continueRun: () => void;
  /** Ends the saved run, keeping its score, and starts a new one. */
  newRun: () => void;
  /** Ends the run where it stands and submits it, keeping its score. */
  finish: () => void;
  /**
   * Marks the moment the player pressed Start, so the submitted duration is the
   * run's and not the time spent reading the rules.
   */
  begin: () => void;
  /** Slides the board. Ignored unless the run is live and the slide changes it. */
  slide: (direction: ColorMergeDirection) => void;
  /** Starts a fresh run, replacing whatever is on the board. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Color Merge against the session API.
 *
 * The same lifecycle as the other four runtimes, because the server treats every
 * game the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that triggers
 * it is guarded — so a re-render cannot send it twice, and a player who retries a
 * failed submission sends the identical body, which the server recognises.
 */
export function useColorMergeRun(gameSlug: string): ColorMergeRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<ColorMergeRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);
  // Set by "New run": the next start skips the saved run and begins afresh.
  const skipSaved = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous board on screen while
    // a session is issued would show a board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    // A signed-in player's unfinished run comes first: it is offered to continue
    // rather than replaced by a new session behind their back.
    const fresh = skipSaved.current;
    skipSaved.current = false;
    (fresh ? Promise.resolve(null) : fetchSavedRun(gameSlug, COLOR_MERGE_RULES_VERSION))
      .then((saved) => {
        if (controller.signal.aborted) return null;
        if (saved) {
          const run = saved.actions.reduce(
            (current: ColorMergeRun, action) =>
              slideColorMerge(current, action as ColorMergeDirection),
            createColorMergeRun(saved.session.seed),
          );
          setState({ status: "saved", session: saved.session, run, playedMs: saved.playedMs });
          return null;
        }
        return startSession(gameSlug, {
          signal: controller.signal,
          rulesVersion: COLOR_MERGE_RULES_VERSION,
        });
      })
      .then((session) => {
        if (!session || controller.signal.aborted) return;
        // The clock starts when the player presses Start (`begin`), not when the
        // session arrives: reading the rules is not part of the run.
        setState({ status: "playing", session, run: createColorMergeRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    // Defensive: every run is begun before it can end, but a missing mark must
    // never turn into a duration measured from the epoch.
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...colorMergeSubmission(run), rulesVersion: session.rulesVersion },
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

  const slide = useCallback((direction: ColorMergeDirection) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = slideColorMerge(current.run, direction);
      // A direction that changes nothing returns the same run, and the same
      // reference means there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const begin = useCallback(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishColorMergeRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const continueRun = useCallback(() => {
    setState((current) => {
      if (current.status !== "saved") return current;
      // The run's clock carries on from the time it had already been played.
      startedAt.current = Date.now() - current.playedMs;
      return { status: "playing", session: current.session, run: current.run };
    });
  }, []);

  const newRun = useCallback(() => {
    if (state.status !== "saved") return;
    const { session, run, playedMs } = state;
    setState({ status: "starting" });
    // The saved run ends here and keeps its score, like any run the player ends:
    // it is submitted as it was left. Only then does the new run start, because
    // starting one closes the player's open session.
    completeRun(
      session.id,
      { ...colorMergeSubmission(run), rulesVersion: session.rulesVersion },
      Math.max(1, playedMs),
    )
      .catch(() => undefined)
      .finally(() => {
        skipSaved.current = true;
        setAttempt((n) => n + 1);
      });
  }, [state]);

  // A signed-in player's live run is kept on their account as it is played.
  useSaveProgress(
    state.status === "playing" && state.run.outcome === "playing"
      ? { session: state.session, actions: state.run.moves }
      : null,
    startedAt,
  );

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, begin, slide, finish, restart, retry, continueRun, newRun };
}

// ── A run of Don't Touch the Black, from session to score ──────────────────

export type DontTouchRunState =
  | { status: "starting" }
  | { status: "playing"; session: PlaySession; run: DontTouchRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: DontTouchRun }
  | { status: "finished"; session: PlaySession; run: DontTouchRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: DontTouchRun;
    };

export type DontTouchRunControls = DontTouchRunState & {
  /**
   * Marks the moment the player pressed Start, so the submitted duration is the
   * run's and not the time spent reading the rules.
   */
  begin: () => void;
  /** Taps one tile. Ignored unless the run is live and the tile is untapped. */
  tap: (cell: number) => void;
  /** Ends the run because the player stopped, or the conveyor hit its ceiling. */
  finish: () => void;
  /** Ends the run if row `row` still has an uncleared white tile as it leaves the line. */
  miss: (row: number) => void;
  /** Starts a fresh run, replacing whatever is on the conveyor. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of Don't Touch the Black against the session API.
 *
 * The same lifecycle as the other five runtimes, because the server treats every
 * game the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that triggers
 * it is guarded — so a re-render cannot send it twice, and a player who retries a
 * failed submission sends the identical body, which the server recognises.
 *
 * Time is the screen's business, not the engine's: the conveyor decides *when* a
 * tile can be touched and calls `finish` when the deck has passed, while every
 * tap is a cell number the rules can replay without a clock.
 */
export function useDontTouchRun(gameSlug: string): DontTouchRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<DontTouchRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous conveyor on screen
    // while a session is issued would show a board with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, {
      signal: controller.signal,
      rulesVersion: DONT_TOUCH_RULES_VERSION,
    })
      .then((session) => {
        if (controller.signal.aborted) return;
        // The clock starts when the player presses Start (`begin`), not when the
        // session arrives: reading the rules is not part of the run.
        setState({ status: "playing", session, run: createDontTouchRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    // Defensive: every run is begun before it can end, but a missing mark must
    // never turn into a duration measured from the epoch.
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...dontTouchSubmission(run), rulesVersion: session.rulesVersion },
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

  const tap = useCallback((cell: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = tapDontTouchTile(current.run, cell);
      // An impossible tap returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const finish = useCallback(() => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishDontTouchRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const miss = useCallback((row: number) => {
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = missDontTouchRow(current.run, row);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const begin = useCallback(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
  }, []);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, begin, tap, finish, miss, restart, retry };
}

// ── A run of 7 Second, from session to score ───────────────────────────────

export type SevenSecondRunState =
  | { status: "starting" }
  | { status: "playing"; session: PlaySession; run: SevenSecondRun }
  /** A finished run is being verified. No score is shown yet. */
  | { status: "submitting"; session: PlaySession; run: SevenSecondRun }
  | { status: "finished"; session: PlaySession; run: SevenSecondRun; result: RunResult }
  | {
      status: "error";
      /** Which half failed: the start of a run, or the submission of one. */
      stage: "start" | "submit";
      error: ApiError;
      session?: PlaySession;
      run?: SevenSecondRun;
    };

export type SevenSecondRunControls = SevenSecondRunState & {
  /** Marks the moment the clock starts, so the submitted duration is the run's. */
  begin: () => void;
  /** Answers the challenge on screen. Ignored unless the run is live. */
  answer: (option: number) => void;
  /** Ends the run because the clock reached zero. */
  finish: () => void;
  /** Starts a fresh run, replacing whatever is on the clock. */
  restart: () => void;
  /** Retries whichever step failed — a new session, or the same submission. */
  retry: () => void;
};

/**
 * Plays one run of 7 Second against the session API.
 *
 * The same lifecycle as the other six runtimes, because the server treats every
 * game the same way: a run exists only after the server issued a session under the
 * game's own rules version, a result exists only after the server verified the
 * submission, and an error is reported as an error rather than as a score of
 * zero. A submission is attempted exactly once per run — the effect that triggers
 * it is guarded — so a re-render cannot send it twice, and a player who retries a
 * failed submission sends the identical body, which the server recognises.
 *
 * Time is the screen's business, not the engine's: the clock decides *when* a run
 * ends and calls `finish`, while every answer is a button number the rules can
 * replay without a clock. The daily limit is the server's business: a signed-in
 * player who has finished today's deck gets a 409 at `start`, which the screen
 * shows as today's attempt being done rather than as a broken game.
 */
export function useSevenSecondRun(gameSlug: string): SevenSecondRunControls {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<SevenSecondRunState>({ status: "starting" });
  const startedAt = useRef(0);
  // When the run ended, captured once. A retry must send the duration the run
  // actually took, not the time the retry happened to be made: the submission is
  // meant to be the same submission, and a number that grows on every attempt
  // would describe a run that did not happen.
  const endedAt = useRef(0);
  const submitting = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    // A new run starts from nothing: keeping the previous clock on screen while a
    // session is issued would show a live game with no session behind it.
    startedAt.current = 0;
    endedAt.current = 0;
    submitting.current = false;
    setState({ status: "starting" });

    startSession(gameSlug, {
      signal: controller.signal,
      rulesVersion: SEVEN_SECOND_RULES_VERSION,
    })
      .then((session) => {
        if (controller.signal.aborted) return;
        // The clock starts when the player starts, not when the session arrives:
        // reading the rules must not cost seven seconds.
        setState({ status: "playing", session, run: createSevenSecondRun(session.seed) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ status: "error", stage: "start", error: asApiError(error) });
      });

    return () => controller.abort();
  }, [gameSlug, attempt]);

  // Verification. It runs when a run has ended, once, and never for a run that is
  // still in progress. The duration is measured from the moment the clock started.
  useEffect(() => {
    if (state.status !== "playing" || state.run.outcome === "playing") return;
    if (submitting.current) return;
    submitting.current = true;

    const { session, run } = state;
    if (startedAt.current === 0) startedAt.current = Date.now();
    if (endedAt.current === 0) endedAt.current = Date.now();
    const durationMs = Math.max(1, Math.round(endedAt.current - startedAt.current));
    setState({ status: "submitting", session, run });

    completeRun(
      session.id,
      { ...sevenSecondSubmission(run), rulesVersion: session.rulesVersion },
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

  const begin = useCallback(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
  }, []);

  const answer = useCallback((option: number) => {
    if (startedAt.current === 0) startedAt.current = Date.now();
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = answerSevenSecond(current.run, option);
      // An impossible answer returns the same run, and the same reference means
      // there is nothing to re-render.
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const finish = useCallback(() => {
    if (startedAt.current === 0) startedAt.current = Date.now();
    setState((current) => {
      if (current.status !== "playing") return current;
      const next = finishSevenSecondRun(current.run);
      return next === current.run ? current : { ...current, run: next };
    });
  }, []);

  const restart = useCallback(() => setAttempt((n) => n + 1), []);

  const retry = useCallback(() => {
    if (state.status !== "error") return;

    if (state.stage === "submit" && state.session && state.run) {
      // The identical submission, sent again. The server recognises a repeated
      // body as the run it already recorded, so this cannot score twice — and a
      // new session here would abandon a run that was only a retry away.
      submitting.current = false;
      setState({ status: "playing", session: state.session, run: state.run });
      return;
    }

    // The run never started: ask for a new session.
    setAttempt((n) => n + 1);
  }, [state]);

  return { ...state, begin, answer, finish, restart, retry };
}

// ── Boards ──────────────────────────────────────────────────────────────────

export type LeaderboardState =
  | { status: "loading" }
  | { status: "ready"; board: Leaderboard }
  | { status: "error"; error: ApiError };

/**
 * Reads one game's board.
 *
 * A board with no scores is `ready` and empty — an answer, not an error — and the
 * screen renders its empty state from that. There is no cached board to fall back
 * to, so a failed read is reported as a failure.
 */
export function useLeaderboard(
  gameSlug: string,
  query: { scope?: BoardScope; period?: BoardPeriod; limit?: number } = {},
): LeaderboardState & { retry: () => void } {
  const board = useQuery(
    {
      ...leaderboardQuery(gameSlug, query),
      // No slug, no board: a caller that has nothing to show yet asks for nothing.
      enabled: gameSlug !== "",
    },
    getQueryClient(),
  );
  const { refetch } = board;
  const retry = useCallback(() => void refetch(), [refetch]);

  if (board.data !== undefined) return { status: "ready", board: board.data, retry };
  if (board.isError) return { status: "error", error: asApiError(board.error), retry };
  return { status: "loading", retry };
}

/** One game's board, for `useLeaderboard` and for a route that prefetches it. */
export function leaderboardQuery(
  gameSlug: string,
  query: { scope?: BoardScope; period?: BoardPeriod; limit?: number } = {},
) {
  const scope = query.scope ?? "global";
  const period = query.period ?? "all";
  const limit = query.limit ?? DEFAULT_BOARD_SIZE;
  return queryOptions({
    // The response carries the caller's own standing, so the viewer is part of the key.
    queryKey: ["leaderboard", gameSlug, scope, period, limit, getSessionUserId() ?? null] as const,
    queryFn: ({ signal }) => fetchLeaderboard(gameSlug, { scope, period, limit }, { signal }),
    // A score just recorded should show up on the next visit, not a minute later.
    staleTime: 10_000,
  });
}
