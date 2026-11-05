import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";

import { Feed } from "@/components/game/Feed";
import { GameExits } from "@/components/game/GameExits";
import { RunEndActions } from "@/components/game/RunEndActions";
import type { Game } from "@/lib/games/catalog";
import { Route as ForYouRoute } from "@/routes/index";

/**
 * Leaving a game for the For You feed lands on that game's card, not the top: the
 * player carries on from where they were.
 */

const CARD_HEIGHT = 800;

const game = (slug: string): Game => ({ slug, title: slug, playable: true }) as Game;
const FEED = [game("gridburst"), game("updraft"), game("decant"), game("sudoku")];

async function renderAt(node: ReactNode) {
  const root = createRootRoute();
  const stub = (path: string) =>
    createRoute({ getParentRoute: () => root, path, component: () => null });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({ getParentRoute: () => root, path: "/", component: () => <>{node}</> }),
      stub("/following"),
      stub("/search"),
      stub("/games/$id"),
      stub("/play/$id"),
      stub("/leaderboards/$id"),
      stub("/login"),
      stub("/signup"),
    ]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  const view = render(<RouterProvider router={router} />);
  await act(async () => {
    await router.load();
  });
  return view;
}

const scroller = () => document.querySelector("article")?.parentElement as HTMLElement;
const cardOnScreen = () => Math.round(scroller().scrollTop / CARD_HEIGHT);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
  // jsdom lays nothing out: stand in for the feed's full-screen cards.
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return [...(this.parentElement?.children ?? [])].indexOf(this) * CARD_HEIGHT;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the way back to For You", () => {
  it("names the game from a finished run", async () => {
    await renderAt(<RunEndActions slug="gridburst" ranked />);
    expect(screen.getByRole("link", { name: /For You/ })).toHaveAttribute(
      "href",
      "/?game=gridburst",
    );
  });

  it("names the game from a screen with nothing left to play", async () => {
    await renderAt(<GameExits slug="updraft" title="Flutter" />);
    expect(screen.getByRole("link", { name: /For You/ })).toHaveAttribute("href", "/?game=updraft");
  });

  it("goes to the plain feed from a screen with no game", async () => {
    await renderAt(<GameExits />);
    expect(screen.getByRole("link", { name: /For You/ })).toHaveAttribute("href", "/");
  });
});

describe("the feed's address", () => {
  const validate = ForYouRoute.options.validateSearch as (search: object) => object;

  it("accepts a game's slug", () => {
    expect(validate({ game: "7-second" })).toEqual({ game: "7-second" });
  });

  it("ignores anything that isn't one", () => {
    expect(validate({})).toEqual({});
    expect(validate({ game: 7 })).toEqual({});
    expect(validate({ game: '"]<script>' })).toEqual({});
  });
});

describe("landing on a card", () => {
  it("opens at the top without a game to land on", async () => {
    await renderAt(<Feed tab="for-you" items={FEED} />);
    expect(cardOnScreen()).toBe(0);
  });

  it("opens on the game's card", async () => {
    await renderAt(<Feed tab="for-you" items={FEED} landOn="decant" />);
    expect(cardOnScreen()).toBe(2);
  });

  it("gets there when the cards arrive after the feed has loaded", async () => {
    let show: (items: Game[]) => void = () => undefined;
    function Later() {
      const [items, setItems] = useState<Game[]>([]);
      show = setItems;
      return <Feed tab="for-you" items={items} landOn="sudoku" />;
    }
    await renderAt(<Later />);
    await act(async () => show(FEED));
    expect(cardOnScreen()).toBe(3);
  });

  it("stays at the top when the game has left the feed", async () => {
    await renderAt(<Feed tab="for-you" items={FEED} landOn="retired-game" />);
    expect(cardOnScreen()).toBe(0);
  });

  describe("when the order changes after landing", () => {
    const reordered = [FEED[2], FEED[0], FEED[3], FEED[1]];

    async function landOnUpdraft() {
      let show: (items: Game[]) => void = () => undefined;
      function Reordering() {
        const [items, setItems] = useState<Game[]>(FEED);
        show = setItems;
        return <Feed tab="for-you" items={items} landOn="updraft" />;
      }
      await renderAt(<Reordering />);
      expect(cardOnScreen()).toBe(1);
      return (items: Game[]) => act(async () => show(items));
    }

    it("follows the card to its new place", async () => {
      const reorder = await landOnUpdraft();
      await reorder(reordered);
      expect(cardOnScreen()).toBe(3);
    });

    it("leaves a player who has started moving where they are", async () => {
      const reorder = await landOnUpdraft();
      fireEvent.pointerDown(scroller());
      scroller().scrollTop = 2 * CARD_HEIGHT;
      await reorder(reordered);
      expect(cardOnScreen()).toBe(2);
    });
  });
});
