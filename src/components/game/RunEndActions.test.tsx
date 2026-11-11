import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SITE_URL } from "@/lib/seo";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock("@/lib/games/catalog", () => ({
  useGame: () => ({ status: "ready", game: { title: "Whittle" }, retry: () => undefined }),
  titleFromSlug: (slug: string) => slug,
}));

const { RunEndActions } = await import("./RunEndActions");

function stubClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { ...navigator, share: undefined, clipboard: { writeText } });
  return writeText;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Share on the result screen", () => {
  it("sits beside Play again and copies the score with a beat-me link", async () => {
    const writeText = stubClipboard();
    render(<RunEndActions slug="whittle" ranked={false} score={124} onRestart={() => undefined} />);

    expect(screen.getByRole("button", { name: "Play again" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    const text = writeText.mock.calls[0]![0] as string;
    expect(text).toContain("I scored 1,240 in Whittle on Unbored.");
    expect(text).toContain(`${SITE_URL}/games/whittle?beat=1240`);
  });

  it("is the main button for a daily game, and carries its grid", async () => {
    const writeText = stubClipboard();
    render(
      <RunEndActions
        slug="guesswork"
        ranked={false}
        score={4}
        daily={{ day: 20_403, result: "3/6", grid: "🟩🟩🟩🟩🟩" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Share result" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(writeText.mock.calls[0]![0]).toContain("🟩🟩🟩🟩🟩");
  });

  it("uses the device's share sheet where there is one", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { ...navigator, share });
    render(<RunEndActions slug="whittle" ranked={false} score={124} onRestart={() => undefined} />);

    fireEvent.click(screen.getByRole("button", { name: "Share" }));

    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    expect(share.mock.calls[0]![0]).toMatchObject({ title: "Whittle" });
  });

  it("isn't offered without a score", () => {
    render(<RunEndActions slug="whittle" ranked={false} onRestart={() => undefined} />);
    expect(screen.queryByRole("button", { name: /^Share/ })).toBeNull();
  });
});
