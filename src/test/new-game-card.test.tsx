import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NewGameCard } from "@/components/game/NewGameCard";
import { describeNotification, newGameOf, type AppNotification } from "@/lib/notifications/store";

function note(overrides: Partial<AppNotification> = {}): AppNotification {
  return {
    id: "n1",
    kind: "system",
    payload: { reason: "new_game", game: "decant", game_title: "Decant", tagline: "Pour it out." },
    readAt: null,
    createdAt: "2026-11-04T00:00:00Z",
    ...overrides,
  };
}

async function renderCard(item: AppNotification) {
  const root = createRootRoute({
    component: () => (
      <ul>
        <NewGameCard item={item} />
      </ul>
    ),
  });
  const router = createRouter({
    routeTree: root.addChildren(
      ["/games/$id", "/play/$id"].map((path) =>
        createRoute({ getParentRoute: () => root, path, component: () => null }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

describe("telling a new game from other notifications", () => {
  it("recognises only a system notification that says so", () => {
    expect(newGameOf(note())).toEqual({
      slug: "decant",
      title: "Decant",
      tagline: "Pour it out.",
    });
    expect(newGameOf(note({ payload: { text: "Maintenance tonight" } }))).toBeNull();
    expect(newGameOf(note({ kind: "score" }))).toBeNull();
  });

  it("does not trust a row with no game in it", () => {
    expect(newGameOf(note({ payload: { reason: "new_game" } }))).toBeNull();
  });

  it("words it for anywhere that shows one line", () => {
    expect(describeNotification(note())).toBe("Decant just landed");
  });
});

describe("the new game card", () => {
  it("names the game and goes straight to playing it", async () => {
    await renderCard(note());

    expect(screen.getByText("New game")).toBeInTheDocument();
    expect(screen.getByText(/Decant/)).toBeInTheDocument();
    expect(screen.getByText("Pour it out.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play Decant" }).getAttribute("href")).toContain(
      "/play/decant",
    );
  });

  it("gives the same game the same line every time", async () => {
    await renderCard(note());
    const first = screen.getByText(/Decant/).textContent;
    document.body.innerHTML = "";

    await renderCard(note());

    expect(screen.getByText(/Decant/).textContent).toBe(first);
  });

  it("only shines while it's new", async () => {
    await renderCard(note());
    expect(document.querySelector(".new-game-shine")).not.toBeNull();
    document.body.innerHTML = "";

    await renderCard(note({ readAt: "2026-11-04T01:00:00Z" }));
    expect(document.querySelector(".new-game-shine")).toBeNull();
  });
});
