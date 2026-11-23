/**
 * The long-form page copy for a game: what it is, how to get better at it, and
 * the questions players ask. It sits under the rules on the game's page
 * (`/games/<slug>`), and the server renders it, so it is what a search engine
 * reads about the game.
 *
 * The rules themselves are not repeated here: they live in `lib/games/rules.ts`,
 * which is what the engines implement. A tip must agree with those rules: when a
 * game's rules change, its guide is checked too.
 *
 * English only for now: the page shows a guide only to English readers, rather
 * than a block of English in the middle of an Albanian page.
 */
export type GameGuide = {
  /** Paragraphs introducing the game. */
  readonly about: readonly string[];
  /** Strategy, one tip per entry. */
  readonly tips: readonly string[];
  /** Questions and answers specific to this game. */
  readonly faq: ReadonlyArray<readonly [question: string, answer: string]>;
};
