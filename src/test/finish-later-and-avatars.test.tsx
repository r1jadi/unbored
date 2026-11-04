import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserAvatar } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { RunLeaveContext } from "@/lib/games/run-progress";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("End run", () => {
  it("is the one choice: the score is kept and the run can be continued", async () => {
    const leave = vi.fn();
    const end = vi.fn();
    render(
      <RunLeaveContext.Provider value={{ resumable: true, leave }}>
        <EndRunButton score={42} disabled={false} onEnd={end} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Your score of 420 is kept, and you can pick this run up again later.");
    expect(screen.queryByRole("button", { name: "Finish later" })).toBeNull();

    fireEvent.click(screen.getByRole("alertdialog").querySelectorAll("button")[1]!);

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
