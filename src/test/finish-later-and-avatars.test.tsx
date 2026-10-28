import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { UserAvatar } from "@/components/common";
import { EndRunButton } from "@/components/game/EndRunButton";
import { RunLeaveContext } from "@/lib/games/run-progress";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Finish later", () => {
  it("is offered for a run that is saved as it is played, and leaves without ending it", async () => {
    const leave = vi.fn();
    const end = vi.fn();
    render(
      <RunLeaveContext.Provider value={{ resumable: true, leave }}>
        <EndRunButton score={42} disabled={false} onEnd={end} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    fireEvent.click(await screen.findByRole("button", { name: "Finish later" }));

    expect(leave).toHaveBeenCalledOnce();
    expect(end).not.toHaveBeenCalled();
  });

  it("is not offered when the run cannot be continued", async () => {
    render(
      <RunLeaveContext.Provider value={{ resumable: false, leave: vi.fn() }}>
        <EndRunButton score={42} disabled={false} onEnd={vi.fn()} />
      </RunLeaveContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "End run" }));
    await screen.findByText("Your score of 42 is kept and sent for verification.");
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
