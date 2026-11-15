import { act, fireEvent, render, screen } from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { CROSSED, CIRCLED, createRun, mark, UNMARKED, type WhittleRun } from "@/lib/games/whittle";

/** The latest run the board was drawn from, so the test can read the marks. */
let latest: WhittleRun;

vi.mock("@/lib/games/sessions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/games/sessions")>();
  return {
    ...actual,
    // A live run with no server: the real Whittle rules behind a plain state.
    useWhittleRun: () => {
      const [run, setRun] = useState(() => createRun("12345"));
      latest = run;
      const onMark = useCallback(
        (cell: number, to: number) => setRun((current) => mark(current, cell, to)),
        [],
      );
      return {
        status: "playing",
        run,
        session: {
          id: "s1",
          gameSlug: "whittle",
          rulesVersion: "whittle@1",
          seed: "12345",
          tileCount: 0,
          startedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
          ranked: false,
        },
        startedAt: Date.now(),
        signedIn: false,
        mark: onMark,
        finish: () => undefined,
        restart: () => undefined,
        retry: () => undefined,
        begin: () => undefined,
        continueRun: () => undefined,
        newRun: () => undefined,
      };
    },
  };
});

const { WhittleRuntime } = await import("./WhittleRuntime");

const cells = () => screen.getAllByRole("button", { name: /^Row \d column \d/ });

describe("Whittle Clear board", () => {
  it("is off on an untouched board, clears every mark, and Undo brings them back", () => {
    render(<WhittleRuntime slug="whittle" title="Whittle" />);
    const clear = screen.getByRole("button", { name: "Clear board" });
    expect(clear).toBeDisabled();

    act(() => fireEvent.click(cells()[0])); // crossed
    act(() => fireEvent.click(cells()[6])); // crossed
    act(() => fireEvent.click(cells()[6])); // circled
    expect(latest.marks[0]).toBe(CROSSED);
    expect(latest.marks[6]).toBe(CIRCLED);
    expect(clear).toBeEnabled();

    expect(latest.moves).toEqual([62, 1]);
    act(() => fireEvent.click(clear));
    expect(latest.marks.every((m) => m === UNMARKED)).toBe(true);
    // A cleared board needs no moves at all: taking marks back doesn't use up the
    // run's moves, and the server's replay agrees.
    expect(latest.moves).toEqual([]);
    expect(clear).toBeDisabled();

    const undo = screen.getByRole("button", { name: "Undo" });
    act(() => fireEvent.click(undo));
    act(() => fireEvent.click(undo));
    expect(latest.marks[0]).toBe(CROSSED);
    expect(latest.marks[6]).toBe(CIRCLED);
  });
});
