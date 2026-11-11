/**
 * Sharing a finished run: a ready-made message with the score, a "beat me" link
 * back to the same game, and for the daily games a spoiler-free grid people can
 * paste into a chat.
 *
 * The link is the game's public page with the score to beat (`?beat=`), so anyone
 * can open it, signed in or not, and the page's own link preview shows the game.
 * The grids say how a day went without saying what the answers were.
 */

import { toast } from "sonner";

import { marksFor, type GuessworkRun, MAX_GUESSES } from "@/lib/games/guesswork";
import { challenge, type SevenSecondRun } from "@/lib/games/seven-second";
import type { CrosswordRun } from "@/lib/games/crossword";
import { points } from "@/lib/format";
import { absoluteUrl } from "@/lib/seo";
import { currentLanguage, t } from "@/lib/settings/language";

/** What a daily game adds to its message: which day, a short result, the grid. */
export type DailyShare = {
  /** The day number the run was played on: days since 1970-01-01. */
  day: number | null;
  /** A short result for the first line, like "4/6" or "X/6". */
  result?: string;
  /** Emoji rows, joined by newlines. */
  grid: string;
  /** How much of today's field this run beat, once enough people have played. */
  beatPercent?: number;
};

/** The score as the result screen shows it. */
function shownScore(score: number): string {
  return points(score).toLocaleString(currentLanguage());
}

/**
 * The game's public page, carrying the score to beat and, when the player is
 * signed in, their username, so the page can name them and offer to follow them.
 */
export function beatMeUrl(slug: string, score: number, from?: string): string {
  const base = `${absoluteUrl(`/games/${slug}`)}?beat=${points(score)}`;
  return from ? `${base}&from=${encodeURIComponent(from)}` : base;
}

/** A day number as a short date ("11 Nov"), in the player's language. */
export function dayDate(day: number): string {
  return new Intl.DateTimeFormat(currentLanguage(), {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(day * 86_400_000));
}

/** The whole message: a headline, the grid for a daily game, and the link. */
export function shareText({
  slug,
  title,
  score,
  daily,
  from,
}: {
  slug: string;
  title: string;
  score: number;
  daily?: DailyShare;
  /** The sharer's username, when signed in. */
  from?: string;
}): string {
  const url = beatMeUrl(slug, score, from);
  if (daily) {
    const head = [title, daily.day !== null ? dayDate(daily.day) : null, daily.result]
      .filter(Boolean)
      .join(" · ");
    return [
      `${head} — ${t("{score} points", { score: shownScore(score) })}`,
      daily.grid,
      ...(daily.beatPercent !== undefined
        ? [t("Better than {percent}% of today's players.", { percent: daily.beatPercent })]
        : []),
      t("Can you beat me? {url}", { url }),
    ].join("\n\n");
  }
  return [
    t("I scored {score} in {title} on Unbored.", { score: shownScore(score), title }),
    t("Can you beat me? {url}", { url }),
  ].join("\n");
}

/**
 * Shares the message through the device's share sheet where there is one, and
 * otherwise copies it. Dismissing the sheet is not a failure, and success is only
 * reported once the clipboard write actually worked.
 */
export async function shareResult(title: string, text: string): Promise<void> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      // The link is inside the text: some apps drop `text` when `url` is set too.
      await navigator.share({ title, text });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
    }
  }
  try {
    if (!navigator.clipboard) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    toast.success(t("Result copied. Paste it anywhere."));
  } catch {
    toast.error(t("Couldn't copy your result."));
  }
}

// ── Daily grids ─────────────────────────────────────────────────────────────

const GREEN = "🟩";
const YELLOW = "🟨";
const GREY = "⬜";
const BLACK = "⬛";
const RED = "🟥";

/** Guesswork: one row per guess, coloured like the board, with no letters. */
export function guessworkShare(run: GuessworkRun): DailyShare {
  const marks = [GREY, YELLOW, GREEN];
  return {
    day: run.day,
    result: `${run.ending === "solved" ? run.guesses.length : "X"}/${MAX_GUESSES}`,
    grid: run.guesses
      .map((word) =>
        marksFor(word, run.answer)
          .map((mark) => marks[mark] ?? GREY)
          .join(""),
      )
      .join("\n"),
  };
}

/**
 * The crossword: the grid's shape, every filled square green, the ones revealed
 * yellow and any left empty or wrong white. Black squares are the shape anyone
 * sees before solving, so nothing about the answers is given away.
 */
export function crosswordShare(run: CrosswordRun): DailyShare {
  const { side, solution } = run.puzzle;
  const rows: string[] = [];
  for (let row = 0; row < side; row += 1) {
    let line = "";
    for (let column = 0; column < side; column += 1) {
      const cell = row * side + column;
      if (solution[cell] === "#") line += BLACK;
      else if (run.revealed[cell]) line += YELLOW;
      else if (run.letters[cell] === solution[cell]) line += GREEN;
      else line += GREY;
    }
    rows.push(line);
  }
  return {
    day: run.puzzle.day,
    result: run.ending === "solved" ? undefined : t("not solved"),
    grid: rows.join("\n"),
  };
}

/** 7 Second's seed is the player's day, hashed as `seven_second_seed` hashes it. */
const SEVEN_SECOND_HASH = 2_654_435_761n;

function sevenSecondDay(seed: string): number | null {
  try {
    const raw = BigInt(seed) - 7n;
    return raw >= 0n && raw % SEVEN_SECOND_HASH === 0n ? Number(raw / SEVEN_SECOND_HASH) : null;
  } catch {
    return null;
  }
}

/** 7 Second: a square per answer, green when right, red when wrong, ten to a row. */
export function sevenSecondShare(run: SevenSecondRun): DailyShare {
  const squares = run.answers.map((option, index) =>
    option === challenge(run.seed, index).correct ? GREEN : RED,
  );
  const rows: string[] = [];
  for (let start = 0; start < squares.length; start += 10) {
    rows.push(squares.slice(start, start + 10).join(""));
  }
  return {
    day: sevenSecondDay(run.seed),
    result: `${run.correct}/${run.answers.length}`,
    grid: rows.join("\n") || "—",
  };
}
