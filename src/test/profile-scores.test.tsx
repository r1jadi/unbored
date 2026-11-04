import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
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

async function renderProfile(
  view: ComponentProps<typeof ProfileView> = {
    self: true,
    user: { username: "player", name: "Player" },
    bestScores: { status: "ready", entries: [{ game: stack10, score: 55 }] },
    recentlyPlayed: { status: "ready", games: [stack10, chain] },
  },
) {
  const root = createRootRoute();
  const paths = ["/", "/activity", "/saved", "/recent", "/login"];
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: "/profile",
        component: () => <ProfileView {...view} />,
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

  it("lays the tabs out as a fixed grid, not a scroller", async () => {
    await renderProfile();

    const bar = screen.getByRole("tablist");
    expect(bar.className).not.toMatch(/overflow/);
    expect(bar.style.gridTemplateColumns).toContain("repeat(5");
  });

  it("tells the owner who can see the profile, with a link to change it", async () => {
    await renderProfile({
      self: true,
      user: { username: "player", name: "Player", bio: "Still mine" },
      visibility: { isPrivate: true, showScores: true },
    });

    expect(screen.getByRole("link", { name: /Private profile · Scores shown/ })).toHaveAttribute(
      "href",
      "/settings/privacy",
    );
    // A private profile hides things from visitors, never from its owner.
    expect(screen.getByText("Still mine")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Recent" })).toBeInTheDocument();
  });
});

describe("a visitor's view of a profile", () => {
  const visitor = {
    user: {
      username: "player",
      name: "Player",
      bio: "A private bio",
      stats: { followers: 3, following: 4 },
    },
    bestScores: { status: "ready", entries: [{ game: stack10, score: 55 }] },
    recentlyPlayed: { status: "ready", games: [stack10] },
  } satisfies ComponentProps<typeof ProfileView>;

  it("shows a public profile's scores, without the viewer's own tabs", async () => {
    await renderProfile({ ...visitor, visibility: { isPrivate: false, showScores: true } });

    expect(screen.getByText("550")).toBeInTheDocument();
    expect(screen.getByText("A private bio")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Activity" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Saved" })).toBeNull();
  });

  it("shows scores on a private profile when the player chose to", async () => {
    await renderProfile({ ...visitor, visibility: { isPrivate: true, showScores: true } });

    expect(screen.getByText("550")).toBeInTheDocument();
    expect(screen.getByText("Private profile")).toBeInTheDocument();
    expect(screen.queryByText("A private bio")).toBeNull();
    expect(screen.queryByText("Followers")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Recent" })).toBeNull();
  });

  it("shows nothing but the private notice when scores are hidden too", async () => {
    await renderProfile({
      ...visitor,
      bestScores: { status: "hidden" },
      recentlyPlayed: { status: "hidden" },
      visibility: { isPrivate: true, showScores: false },
    });

    expect(screen.getByText("This profile is private")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("550")).toBeNull();
  });

  it("says scores are hidden on a public profile that hides them", async () => {
    await renderProfile({
      ...visitor,
      bestScores: { status: "hidden" },
      visibility: { isPrivate: false, showScores: false },
    });

    expect(screen.getByText("Scores are hidden")).toBeInTheDocument();
    expect(screen.getByText("A private bio")).toBeInTheDocument();
  });
});
