/**
 * Deep Cut: the rare-answer trivia game — its tiers, its turns, its share grid and
 * the calls that play it.
 *
 * Every other game's rules run on the device and are replayed by the database. Deep
 * Cut's cannot: its answer bank is its score, and a browser holding the bank could
 * look up the rarest answer to every question. So this module holds no answers. The
 * server deals each question when its clock starts and judges each answer as it
 * arrives (`deep_cut_reveal`, `deep_cut_answer` in
 * `supabase/migrations/20270102120000_deep_cut_sessions.sql`); what lives here is
 * the shape of what comes back, and the arithmetic the result screen and the daily
 * submission need.
 *
 * Three modes share one run shape:
 *   - **daily** — today's seven questions, the same for everyone, one ranked play.
 *     The run's id is its play session's, and it is completed like every game's.
 *   - **unlimited** — seven questions at random, unranked.
 *   - **archive** — a past day's seven, unranked.
 *
 * See docs/games/README.md, "Deep Cut".
 */

import { apiFetch } from "@/lib/api/client";
import { getAccessToken } from "@/lib/auth/session";
import { msg } from "@/lib/settings/language";

export const DEEP_CUT_RUNTIME = "deep-cut";
export const DEEP_CUT_RULES_VERSION = "deep-cut@1";
export const DEEP_CUT_QUESTIONS = 7;
export const DEEP_CUT_SECONDS = 25;
/** A perfect day on screen: seven abyss answers. */
export const DEEP_CUT_MAX_POINTS = 700;

export type DeepCutMode = "daily" | "unlimited" | "archive";

// ── Tiers ─────────────────────────────────────────────────────────────────────

export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

export type TierInfo = {
  tier: Tier;
  name: string;
  points: number;
  /** How deep the answer dives, for the gauge. Flavour, not a rule. */
  depth: string;
  /** The tier's square in the share grid. */
  square: string;
};

/** Surface to Abyss. The points are the server's (`deep_cut_tier_points`). */
export const TIERS: readonly TierInfo[] = [
  { tier: 1, name: msg("Surface"), points: 10, depth: "0 m", square: "🟨" },
  { tier: 2, name: msg("Shallows"), points: 20, depth: "10 m", square: "🟩" },
  { tier: 3, name: msg("Reef"), points: 40, depth: "40 m", square: "🟦" },
  { tier: 4, name: msg("Twilight"), points: 60, depth: "200 m", square: "🟪" },
  { tier: 5, name: msg("Midnight"), points: 80, depth: "1,000 m", square: "⬛" },
  { tier: 6, name: msg("Abyss"), points: 100, depth: "4,000 m", square: "🐙" },
];

export const MISS_SQUARE = "❌";

export function tierInfo(tier: number | null | undefined): TierInfo | null {
  return TIERS.find((info) => info.tier === tier) ?? null;
}

// ── Turns ─────────────────────────────────────────────────────────────────────

export type Verdict = "correct" | "wrong" | "unverified" | "timeout" | "skipped";

/** One answered question, as the server settled it. */
export type DeepCutTurn = {
  position: number;
  verdict: Verdict;
  /** The answer as typed. */
  answer: string | null;
  /** The bank's name for the matched answer. */
  canonical: string | null;
  /** The matched answer's id, or 0: a daily run submits these as its actions. */
  answerId: number;
  tier: Tier | null;
  points: number;
  /** How many players gave this answer, once enough have answered. */
  sharePercent: number | null;
  /** What most people say. */
  commonAnswer: string | null;
  /** Some of the rarest answers — practice only. */
  deepestAnswers: string | null;
};

/** A dealt question. */
export type DeepCutQuestion = {
  runId: string;
  mode: DeepCutMode;
  day: number | null;
  position: number;
  total: number;
  category: string;
  prompt: string;
  seconds: number;
  /** Clock left by the server's time, when the question arrived. */
  remainingMs: number;
  /** Already answered (a run continued from an earlier session). */
  settled: DeepCutTurn | null;
};

/** The prompt each turn asked, kept beside the turn for the result screen. */
export type PlayedTurn = DeepCutTurn & { prompt: string; category: string };

export function totalPoints(turns: readonly Pick<DeepCutTurn, "points">[]): number {
  return turns.reduce((sum, turn) => sum + turn.points, 0);
}

/**
 * The daily submission: each dealt question's matched answer id (0 for a miss), in
 * order, and the score as the verifier counts it — a tenth of the points shown.
 * `open` is a question dealt but not answered when the run ended: the server
 * settles it as skipped, so it is sent as 0.
 */
export function deepCutSubmission(turns: readonly DeepCutTurn[], open = false) {
  const actions = turns.map((turn) => (turn.verdict === "correct" ? turn.answerId : 0));
  if (open) actions.push(0);
  return {
    rulesVersion: DEEP_CUT_RULES_VERSION,
    actions,
    score: totalPoints(turns) / 10,
  };
}

/** A verdict in words, for the reveal and the result rows. */
export function verdictLabel(turn: Pick<DeepCutTurn, "verdict" | "tier">): string {
  switch (turn.verdict) {
    case "correct":
      return tierInfo(turn.tier)?.name ?? msg("Correct");
    case "wrong":
      return msg("Not a valid answer");
    case "unverified":
      return msg("Not in our depths yet");
    case "timeout":
      return msg("Out of time");
    case "skipped":
      return msg("Skipped");
  }
}

// ── The result ────────────────────────────────────────────────────────────────

/** A run's total as a rank, for the result screen. */
export function ratingFor(points: number): { title: string; blurb: string } {
  if (points >= DEEP_CUT_MAX_POINTS)
    return { title: msg("Abyss legend"), blurb: msg("Seven answers nobody else gave. Flawless.") };
  if (points >= 500)
    return { title: msg("Trench explorer"), blurb: msg("You live where the light doesn't reach.") };
  if (points >= 350) return { title: msg("Deep diver"), blurb: msg("Well below the crowd.") };
  if (points >= 200)
    return { title: msg("Reef diver"), blurb: msg("Some real deep cuts in there.") };
  if (points >= 80)
    return { title: msg("Snorkeler"), blurb: msg("Safe answers. Try diving deeper.") };
  return { title: msg("Paddler"), blurb: msg("Everyone starts at the surface.") };
}

/** The spoiler-free grid: one square per question, by tier, a cross for a miss. */
export function shareGrid(turns: readonly Pick<DeepCutTurn, "verdict" | "tier">[]): string {
  return turns
    .map((turn) =>
      turn.verdict === "correct" ? (tierInfo(turn.tier)?.square ?? MISS_SQUARE) : MISS_SQUARE,
    )
    .join("");
}

/** The deepest tier a run reached, or null with no correct answer. */
export function deepestTier(turns: readonly Pick<DeepCutTurn, "verdict" | "tier">[]): Tier | null {
  let best: Tier | null = null;
  for (const turn of turns) {
    if (turn.verdict === "correct" && turn.tier && (best === null || turn.tier > best)) {
      best = turn.tier;
    }
  }
  return best;
}

/** Days since 1970-01-01 in UTC, the archive's day numbers. */
export function utcDayNumber(now: number = Date.now()): number {
  return Math.floor(now / 86_400_000);
}

/** A day number as a date, in the reader's locale. */
export function dayLabel(day: number, locale?: string): string {
  return new Date(day * 86_400_000).toLocaleDateString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

// ── The calls ─────────────────────────────────────────────────────────────────

const Routes = {
  practice: "/deep-cut/practice",
  archive: "/deep-cut/archive",
  question: (runId: string, position: number) =>
    `/deep-cut/runs/${encodeURIComponent(runId)}/questions/${position}`,
  check: (runId: string, position: number) =>
    `/deep-cut/runs/${encodeURIComponent(runId)}/questions/${position}/check`,
  answer: (runId: string, position: number) =>
    `/deep-cut/runs/${encodeURIComponent(runId)}/questions/${position}/answer`,
  summary: (runId: string) => `/deep-cut/runs/${encodeURIComponent(runId)}/summary`,
};

type RawTurn = Partial<DeepCutTurn> & { verdict: Verdict };

function asTurn(raw: RawTurn): DeepCutTurn {
  return {
    position: raw.position ?? 0,
    verdict: raw.verdict,
    answer: raw.answer ?? null,
    canonical: raw.canonical ?? null,
    answerId: raw.answerId ?? 0,
    tier: (raw.tier ?? null) as Tier | null,
    points: raw.points ?? 0,
    sharePercent: raw.sharePercent ?? null,
    commonAnswer: raw.commonAnswer ?? null,
    deepestAnswers: raw.deepestAnswers ?? null,
  };
}

/** Starts an unranked run. */
export async function startPractice(
  mode: "unlimited" | "archive",
  day: number | null,
  signal?: AbortSignal,
): Promise<{ runId: string; swapped: number }> {
  const body = await apiFetch<{ runId: string; swapped?: number }>(Routes.practice, {
    method: "POST",
    body: mode === "archive" ? { mode, day } : { mode },
    token: getAccessToken(),
    signal,
  });
  return { runId: body.runId, swapped: body.swapped ?? 0 };
}

/** The past days the archive can deal, newest first. */
export async function fetchArchiveDays(signal?: AbortSignal): Promise<number[]> {
  const body = await apiFetch<{ days: number[] }>(Routes.archive, {
    token: getAccessToken(),
    signal,
    retryable: true,
  });
  return body.days;
}

/** Deals question `position`, starting its clock. Safe to repeat. */
export async function revealQuestion(
  runId: string,
  position: number,
  signal?: AbortSignal,
): Promise<DeepCutQuestion> {
  const body = await apiFetch<
    Omit<DeepCutQuestion, "settled"> & { settled: RawTurn | null; remainingMs?: number }
  >(Routes.question(runId, position), {
    method: "POST",
    body: {},
    token: getAccessToken(),
    signal,
    retryable: true,
  });
  return {
    runId: body.runId,
    mode: body.mode,
    day: body.day ?? null,
    position: body.position,
    total: body.total,
    category: body.category,
    prompt: body.prompt,
    seconds: body.seconds,
    remainingMs: body.remainingMs ?? body.seconds * 1000,
    settled: body.settled ? asTurn(body.settled) : null,
  };
}

/**
 * What the server says about an answer before it is submitted:
 *   - `valid` — it counts (the tier stays a secret until it is submitted);
 *   - `invalid` — not a correct answer: the player may type another;
 *   - `ambiguous` — a near-miss spelling of two different answers;
 *   - `unknown` — nobody could rule on it yet: submitting it is the player's call;
 *   - `empty`, `late` — nothing to check, or the clock has run out.
 */
export type CheckResult = "valid" | "invalid" | "ambiguous" | "unknown" | "empty" | "late";

/** A check, with up to two answers the player may have meant when it doesn't count. */
export type Check = { result: CheckResult; suggestions: string[] };

/** Checks an answer to question `position` without submitting it. Records nothing. */
export async function checkAnswer(
  runId: string,
  position: number,
  answer: string,
  signal?: AbortSignal,
): Promise<Check> {
  const body = await apiFetch<{ result: CheckResult; suggestions?: string[] }>(
    Routes.check(runId, position),
    {
      method: "POST",
      body: { answer },
      token: getAccessToken(),
      signal,
      // The judge may be consulted: give it room, but less than the clock.
      timeoutMs: 9_000,
    },
  );
  return { result: body.result, suggestions: (body.suggestions ?? []).slice(0, 2) };
}

/** Answers question `position`. One answer per question; a repeat returns the first. */
export async function answerQuestion(
  runId: string,
  position: number,
  answer: string,
  signal?: AbortSignal,
): Promise<DeepCutTurn> {
  const body = await apiFetch<{ turn: RawTurn }>(Routes.answer(runId, position), {
    method: "POST",
    body: { answer },
    token: getAccessToken(),
    signal,
    // The judge may be consulted: give it room.
    timeoutMs: 20_000,
    retryable: true,
  });
  return asTurn(body.turn);
}

/** Ends a practice run and totals it on the server. */
export async function finishPractice(
  runId: string,
  signal?: AbortSignal,
): Promise<{ points: number; turns: DeepCutTurn[] }> {
  const body = await apiFetch<{ points: number; turns: RawTurn[] }>(Routes.summary(runId), {
    method: "POST",
    body: {},
    token: getAccessToken(),
    signal,
    retryable: true,
  });
  return { points: body.points, turns: body.turns.map(asTurn) };
}
