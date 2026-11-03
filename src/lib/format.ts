/**
 * Number formatting for the UI.
 *
 * It lives here rather than next to any one feature because every screen that
 * shows a count — scores, followers, comments — wants the same abbreviation, and
 * a shared helper is the only way two screens cannot drift into "1.2K" and
 * "1,200" for the same number.
 *
 * It is deliberately not a general-purpose `Intl` wrapper: the product is a feed
 * of short games where a score is read at a glance, so the compact form (a period
 * as the decimal separator, one decimal place, no trailing `.0`) is a design
 * decision rather than a localisation one.
 */
import { currentLanguage } from "@/lib/settings/language";

/** Albanian's short month names, from January. */
const ALBANIAN_MONTHS = [
  "jan",
  "shk",
  "mar",
  "pri",
  "maj",
  "qer",
  "korr",
  "gush",
  "sht",
  "tet",
  "nën",
  "dhj",
];

/**
 * A date as "Sep 1, 2026", or "1 sht 2026" in Albanian.
 *
 * Albanian is spelled out here rather than asked of `Intl`: browsers built with
 * reduced locale data (and some Node builds) have no Albanian, and would print
 * English — differently from the server, which would break hydration. English
 * names its locale for the same reason: the page must not depend on the
 * machine's own.
 */
export function shortDate(date: Date, withYear: boolean): string {
  if (currentLanguage() === "sq") {
    const day = `${date.getDate()} ${ALBANIAN_MONTHS[date.getMonth()]}`;
    return withYear ? `${day} ${date.getFullYear()}` : day;
  }
  return date.toLocaleDateString("en-US", {
    ...(withYear ? { year: "numeric" } : {}),
    month: "short",
    day: "numeric",
  });
}

export const fmt = (n: number): string =>
  n >= 1_000_000
    ? `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`
      : `${n}`;

/**
 * How many points a unit of score is worth on screen.
 *
 * Scores are stored and verified in the rules' own units (a cleared Stack 10
 * column is 10, a Gridburst cell 1), and the server's checks compare those
 * exactly. Every score a player sees is shown multiplied by this, so a clear
 * reads +100 — and because it is applied to every score shown, the boards, a
 * personal best and a run in progress always agree with one another.
 */
export const SCORE_SCALE = 10;

/** A score as shown to players: see `SCORE_SCALE`. */
export const points = (score: number): number => score * SCORE_SCALE;

/**
 * A stored timestamp as a short, local date.
 *
 * It returns `undefined` for a missing or unparseable value rather than
 * `Invalid Date`, so a caller can decide to render nothing instead of a broken
 * label — the same rule the rest of the app follows for a value it does not have.
 */
export const fmtDate = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return shortDate(date, true);
};
