import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserAvatar } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { canContinueRun, canFinishLater, RunLeaveContext } from "@/lib/games/run-progress";
import type { PlaySession } from "@/lib/games/sessions";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("End run", () => {
  it("offers Finish later too, like the quit control, when the run can be continued", async () => {
    const leave = vi.fn();
    const end = vi.fn();
    render(
      <RunLeaveContext.Provider value={{ resumable: true, leave }}>
        <EndRunButton score={42} disabled={false} onEnd={end} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Your score of 420 is kept, and you can pick this run up again later.");
    fireEvent.click(screen.getByRole("button", { name: "Finish later" }));
    expect(leave).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
  });

  it("still ends the run with End run", async () => {
    const leave = vi.fn();
    const end = vi.fn();
    render(
      <RunLeaveContext.Provider value={{ resumable: true, leave }}>
        <EndRunButton score={42} disabled={false} onEnd={end} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "End run" }));
    expect(end).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();
  });

  it("doesn't promise a continue when the run can't be continued", async () => {
    render(
      <RunLeaveContext.Provider value={{ resumable: false, leave: vi.fn() }}>
        <EndRunButton score={42} disabled={false} onEnd={vi.fn()} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Your score of 420 is kept and sent for verification.");
    expect(screen.queryByRole("button", { name: "Finish later" })).toBeNull();
  });
});

describe("Finish later is for timed games", () => {
  const session = (rulesVersion: string, ranked = true): PlaySession => ({
    id: "cccccccc-1111-4111-8111-cccccccccccc",
    gameSlug: "game",
    rulesVersion,
    seed: "1",
    tileCount: 0,
    startedAt: "2026-11-16T12:00:00.000Z",
    expiresAt: "2026-11-16T14:00:00.000Z",
    ranked,
  });

  it("is offered on a countdown game", () => {
    for (const rules of ["zip@2", "tango@2", "decant@2", "checkmate@1"]) {
      expect(canFinishLater(session(rules)), rules).toBe(true);
    }
  });

  it("isn't offered on an untimed game, which can still be continued once ended", () => {
    for (const rules of ["cascade@1", "stack-10@2", "sudoku@4", "whittle@1"]) {
      expect(canFinishLater(session(rules)), rules).toBe(false);
      expect(canContinueRun(session(rules)), rules).toBe(true);
    }
  });

  it("isn't offered on a game that isn't saved as it is played, or to a guest", () => {
    expect(canFinishLater(session("seven-second@1"))).toBe(false);
    expect(canFinishLater(session("zip@2", false))).toBe(false);
  });

  it("End run on an untimed game still promises a continue, without Finish later", async () => {
    render(
      <RunLeaveContext.Provider value={{ resumable: false, continuable: true, leave: vi.fn() }}>
        <EndRunButton score={42} disabled={false} onEnd={vi.fn()} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Your score of 420 is kept, and you can pick this run up again later.");
    expect(screen.queryByRole("button", { name: "Finish later" })).toBeNull();
  });
});

describe("UserAvatar", () => {
  it("looks pictures up by username in one request and shows them", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify([
            { username: "nora", avatar_path: "9c1f0b2a-0000-4000-8000-000000000000/nora.png" },
            { username: "ivo", avatar_path: null },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(
      <>
        <UserAvatar username="nora" />
        <UserAvatar username="Nora" />
        <UserAvatar username="ivo" />
      </>,
    );

    await waitFor(() => expect(container.querySelectorAll("img")).toHaveLength(2));
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "/storage/v1/object/public/avatars/9c1f0b2a-0000-4000-8000-000000000000/nora.png",
    );
    // An account with no picture keeps its initials.
    expect(screen.getByText("IV")).toBeTruthy();
  });

  it("uses a path the screen already has without asking again", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      <UserAvatar username="someone-new" path="9c1f0b2a-0000-4000-8000-000000000000/a.png" />,
    );
    expect(container.querySelector("img")).not.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
