/**
 * The introduction under each category's games on `/categories/<slug>`: what
 * the games in it have in common and what they ask of you. Server-rendered, so
 * a category page carries text of its own and not just a grid of cards.
 *
 * English only for now, like the game guides; the page shows it to English
 * readers only.
 */
export type CategoryGuide = {
  readonly heading: string;
  readonly paragraphs: readonly string[];
};

export const CATEGORY_GUIDES: Readonly<Record<string, CategoryGuide>> = {
  puzzle: {
    heading: "About puzzle games",
    paragraphs: [
      "The puzzle games on Unbored are about arranging things: merging tiles, sorting colours into tubes and nuts onto bolts, sliding blocks to their exits, dropping pieces to fill lines, or setting off chain reactions. Each one has a single clear goal on every board, and the challenge comes from the order you do things in.",
      "Most of them are runs rather than single levels. Solve a board and the next is a little bigger or busier, so a run is a steady climb in difficulty. Some race a clock that each solved board tops up; others have no timer at all and end only when the board locks. Every game page explains its rules and has tips for getting further.",
    ],
  },
  logic: {
    heading: "About logic games",
    paragraphs: [
      "Logic games are puzzles of pure deduction. Sudoku, mine-finding, picture grids, crown placement and number crossing-out all share one promise: every board has exactly one solution, and you can reach it by reasoning alone, without guessing.",
      "That makes them games of patience rather than speed. Most have no clock to lose to — you can take as long as you need on a board — but a quick solve earns a bonus, so getting faster at spotting the standard deductions pays. Each game page lists the techniques that crack its boards most often.",
    ],
  },
  word: {
    heading: "About word games",
    paragraphs: [
      "The word games on Unbored are built around a daily challenge: a hidden five-letter word to find in six guesses, a mini crossword with original clues, a hive of seven letters to make words from, a grid of winding hidden words, and a timeline of events to put in order.",
      "Everyone gets the same puzzle each day, and a new one arrives at midnight in your own time zone, so you can compare results with friends. Several of them are also available in Albanian, with their own Albanian words and clues.",
    ],
  },
  daily: {
    heading: "About daily games",
    paragraphs: [
      "Daily games give everyone the same challenge for a whole day: the same deck of sums, the same price to guess, the same trivia category, the same golf course or the same case to crack. A new one arrives at midnight in your own time zone.",
      "Your first play each day is the ranked one, which keeps the leaderboards fair: nobody can replay their way to the top. They take a few minutes each, which makes them a good daily habit — and a good way to compare scores with friends who played the same puzzle.",
    ],
  },
  arcade: {
    heading: "About arcade games",
    paragraphs: [
      "Arcade games test reflexes and timing. Tap the right tiles as the rows rise, flap a glider through gaps, flip gravity to dodge spikes: one mistake usually ends the run, and the pace picks up the longer you last.",
      "There's no final level in any of them, so your score is simply how far you got. Short runs make them easy to pick up for a minute, and the leaderboards show how your best compares with everyone else's.",
    ],
  },
  memory: {
    heading: "About memory games",
    paragraphs: [
      "Memory games show you something once and ask you to repeat it: a pattern of lit cells to rebuild, or a sequence of flashes to tap back in order. Each round adds one more thing to remember, and the time you get to see it shrinks.",
      "They reward technique as much as raw memory. Grouping a sequence into chunks, or seeing a pattern as a shape rather than separate cells, can add several rounds to your best. Each game page has tips on how.",
    ],
  },
  reaction: {
    heading: "About reaction games",
    paragraphs: [
      "Reaction games are about speed and accuracy under pressure: following a sequence as it gets faster, or answering before the clock runs out. They're short, intense and easy to try again.",
      "The best scores come from staying calm. A steady rhythm usually beats rushing, because a single mistake ends the run.",
    ],
  },
  strategy: {
    heading: "About strategy games",
    paragraphs: [
      "Strategy games reward planning a few moves ahead: fewer moves and a better plan beat quick reactions. Take your time, think about where each move leaves you, and look for the move that keeps the most options open.",
    ],
  },
};

export function categoryGuideFor(slug: string): CategoryGuide | null {
  return CATEGORY_GUIDES[slug] ?? null;
}
