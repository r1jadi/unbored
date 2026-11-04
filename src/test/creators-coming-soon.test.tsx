import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CreatorsComingSoon } from "@/components/game/CreatorsComingSoon";

async function renderCard() {
  const root = createRootRoute();
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/", component: () => <p>feed</p> }),
      createRoute({
        getParentRoute: () => root,
        path: "/following",
        component: () => <CreatorsComingSoon />,
      }),
    ]),
    history: createMemoryHistory({ initialEntries: ["/following"] }),
  });
  render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
}

describe("the creators coming-soon card", () => {
  it("says player-made games are coming, and offers a game to play now", async () => {
    await renderCard();

    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Player-made games are on the way" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Play a game" })).toHaveAttribute("href", "/");
    // It must not read as if the people you follow could have published something.
    expect(screen.queryByText(/haven't published/)).toBeNull();
  });

  it("hides its decorative board from assistive technology", async () => {
    await renderCard();

    expect(screen.getByTestId("workshop-board")).toHaveAttribute("aria-hidden", "true");
  });
});
