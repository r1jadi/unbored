import { describe, expect, it } from "vitest";

import type { CrosswordRun } from "@/lib/games/crossword";
import type { GuessworkRun } from "@/lib/games/guesswork";
import { challenge, type SevenSecondRun } from "@/lib/games/seven-second";
import { gameImage, SITE_URL } from "@/lib/seo";

import { beatMeUrl, crosswordShare, guessworkShare, sevenSecondShare, shareText } from "./share";

describe("share text", () => {
  it("names the game and the score as shown, with a beat-me link to the game page", () => {
    const text = shareText({ slug: "whittle", title: "Whittle", score: 124 });
    expect(text).toContain("I scored 1,240 in Whittle on Unbored.");
    expect(text).toContain(`Can you beat me? ${SITE_URL}/games/whittle?beat=1240`);
  });

  it("puts a daily game's day, result and grid between the headline and the link", () => {
    const text = shareText({
      slug: "guesswork",
      title: "Guesswork",
      score: 4,
      daily: { day: 20_403, result: "3/6", grid: "⬜🟨⬜⬜⬜\n🟩🟩🟩🟩🟩" },
    });
    const [head, grid, link] = text.split("\n\n");
    expect(head).toBe("Guesswork · Nov 11 · 3/6 — 40 points");
    expect(grid).toBe("⬜🟨⬜⬜⬜\n🟩🟩🟩🟩🟩");
    expect(link).toBe(`Can you beat me? ${beatMeUrl("guesswork", 4)}`);
  });
});

describe("daily grids are spoiler-free", () => {
  it("Guesswork: colours per guess and no letters", () => {
    const run = {
      day: 20_403,
      answer: "CRANE",
      guesses: ["SLATE", "CRANE"],
      ending: "solved",
    } as unknown as GuessworkRun;
    const share = guessworkShare(run);
    expect(share.result).toBe("2/6");
    expect(share.grid).toBe("⬜⬜🟩⬜🟩\n🟩🟩🟩🟩🟩");
    expect(share.grid).not.toMatch(/[A-Z]/);
  });

  it("Guesswork: an unsolved day is X", () => {
    const run = {
      day: 1,
      answer: "CRANE",
      guesses: ["SLATE"],
      ending: "out",
    } as unknown as GuessworkRun;
    expect(guessworkShare(run).result).toBe("X/6");
  });

  it("Crossword: the grid's shape, with filled, revealed and missing squares", () => {
    const solution = "AB#CDEF#G";
    const run = {
      puzzle: { day: 20_403, side: 3, solution },
      letters: ["A", "B", "", "C", "X", "", "F", "", "G"],
      revealed: [false, true, false, false, false, false, false, false, false],
      ending: "solved",
    } as unknown as CrosswordRun;
    const share = crosswordShare(run);
    expect(share.grid).toBe("🟩🟨⬛\n🟩⬜⬜\n🟩⬛🟩");
    expect(share.grid).not.toMatch(/[A-Z]/);
    expect(share.result).toBeUndefined();
  });

  it("7 Second: right and wrong per answer, ten to a row, and the day from the seed", () => {
    const day = 20_403;
    const seed = (BigInt(day) * 2_654_435_761n + 7n).toString();
    const answers = Array.from({ length: 12 }, (_, index) =>
      index % 3 === 0 ? (challenge(seed, index).correct + 1) % 3 : challenge(seed, index).correct,
    );
    const run = {
      seed,
      answers,
      correct: answers.filter((option, index) => option === challenge(seed, index).correct).length,
    } as unknown as SevenSecondRun;
    const share = sevenSecondShare(run);
    expect(share.day).toBe(day);
    expect(share.result).toBe("8/12");
    expect(share.grid).toBe("🟥🟩🟩🟥🟩🟩🟥🟩🟩🟥\n🟩🟩");
  });
});

describe("link preview images", () => {
  it("points a game with a drawn image at it, at its size", () => {
    expect(gameImage("whittle")).toEqual({
      image: "/og/whittle.png",
      imageSize: { width: 1200, height: 630 },
    });
  });

  it("leaves a game without one to the site icon", () => {
    expect(gameImage("not-a-real-game")).toBeUndefined();
  });
});
