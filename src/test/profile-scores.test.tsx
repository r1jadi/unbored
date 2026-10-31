import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProfileView } from "@/components/social/ProfileView";
import type { Game } from "@/lib/games/catalog";

const stack10: Game = {
  slug: "stack-10",
  title: "Stack 10",
  tagline: "Make every column add up to ten.",
  description: null,
  instructions: null,
  category: { slug: "puzzle", name: "Puzzle" },
  runtime: "stack10",
  playable: true,
  plays: 2,
  isOfficial: true,
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const chain: Game = {
  ...stack10,
  slug: "dont-break-the-chain",
  title: "Don't Break the Chain",
  category: { slug: "reaction", name: "Reaction" },
  runtime: "chain",
};

async function renderProfile() {
  const root = createRootRoute();
  const paths = ["/", "/activity", "/saved", "/recent", "/login"];
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/profile",
        component: () => (
          <ProfileView
            self
            user={{ username: "player", name: "Player" }}
            bestScores={{ status: "ready", entries: [{ game: stack10, score: 55 }] }}
            recentlyPlayed={{ status: "ready", games: [stack10, chain] }}
          />
        ),
      }),
      ...paths.map((path) =>
        createRoute({ getParentRoute: () => root, path, component: () => <p>{path}</p> }),
      ),
      createRoute({
        getParentRoute: () => root,
        path: "/games/$id",
        component: () => <p>game</p>,
      }),
      createRoute({
        getParentRoute: () => root,
        path: "/settings/$section",
        component: () => <p>settings</p>,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/profile"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

describe("profile score tabs", () => {
  it("shows saved best scores instead of claiming none exist", async () => {
    await renderProfile();

    expect(screen.getByRole("link", { name: "Stack 10" })).toBeInTheDocument();
    expect(screen.getByText("550")).toBeInTheDocument();
    expect(screen.queryByText("No scores yet")).toBeNull();
  });

  it("shows played games on the Recent tab", async () => {
    await renderProfile();

    await act(async () => {
      screen.getByRole("tab", { name: "Recent" }).click();
    });

    expect(screen.getByRole("link", { name: "Stack 10" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Don't Break the Chain" })).toBeInTheDocument();
    expect(screen.queryByText("No games played yet")).toBeNull();
  });
});
