import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepCutParty } from "@/components/game/DeepCutParty";
import {
  alive,
  boom,
  FUSE_MAX_MS,
  FUSE_MIN_MS,
  fuseLength,
  newPlayers,
  nextAlive,
  scored,
  standings,
  tidyNames,
} from "@/lib/games/deep-cut-party";
import { clearSession } from "@/lib/auth/session";
import { resetLanguageForTests } from "@/lib/settings/language";

const PARTY = "efefefef-6666-4666-8666-efefefefefef";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A party server: Apple and Banana count, Carrot doesn't, a repeat is refused. */
function partyServer() {
  const said = new Set<string>();
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const spy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, body });
    if (url.endsWith("/deep-cut/parties")) {
      return jsonResponse({ outcome: "started", partyId: PARTY, players: body["players"] });
    }
    const round = /rounds\/(\d+)$/.exec(url);
    if (round) {
      said.clear();
      return jsonResponse({
        outcome: "shown",
        round: Number(round[1]),
        category: "Food",
        prompt: "Name a fruit",
        used: [],
      });
    }
    if (/rounds\/\d+\/answers$/.test(url)) {
      const answer = String(body["answer"]).toLowerCase();
      if (answer === "carrot") return jsonResponse({ outcome: "judged", result: "invalid" });
      if (answer === "banan") {
        return jsonResponse({ outcome: "judged", result: "invalid", suggestions: ["Banana"] });
      }
      if (said.has(answer)) {
        return jsonResponse({ outcome: "judged", result: "repeat", canonical: "Apple" });
      }
      said.add(answer);
      return jsonResponse({
        outcome: "judged",
        result: "valid",
        canonical: answer === "apple" ? "Apple" : "Banana",
        tier: 1,
        points: 10,
      });
    }
    return jsonResponse({ code: "not_found", message: "Not found" }, 404);
  });
  vi.stubGlobal("fetch", spy);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  clearSession();
  resetLanguageForTests();
});

describe("the party table", () => {
  it("goes round the table, skipping players who are out", () => {
    let players = newPlayers(["Ann", "Ben", "Cat"], 1);
    expect(nextAlive(players, 0)).toBe(1);
    expect(nextAlive(players, 2)).toBe(0);
    players = boom(players, 1);
    expect(alive(players)).toEqual([0, 2]);
    expect(nextAlive(players, 0)).toBe(2);
  });

  it("ranks by lives, then points", () => {
    let players = newPlayers(["Ann", "Ben", "Cat"], 2);
    players = scored(players, 2, 80);
    players = boom(players, 0);
    expect(standings(players).map((entry) => entry.player.name)).toEqual(["Cat", "Ben", "Ann"]);
  });

  it("keeps the fuse inside its range", () => {
    expect(fuseLength(() => 0)).toBe(FUSE_MIN_MS);
    expect(fuseLength(() => 1)).toBe(FUSE_MAX_MS);
  });

  it("tidies the names typed at the table", () => {
    expect(tidyNames(["  Ann ", "", "ann"], (n) => `Player ${n}`)).toEqual([
      "Ann",
      "Player 2",
      "ann 2",
    ]);
  });
});

describe("hot potato on screen", () => {
  async function startTable() {
    const calls = partyServer();
    render(<DeepCutParty onExit={() => {}} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name of player 1" }), {
      target: { value: "Ann" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name of player 2" }), {
      target: { value: "Ben" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove player 3" }));
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    fireEvent.click(screen.getByRole("button", { name: "Light the fuse" }));
    await screen.findByRole("heading", { name: "Name a fruit" });
    return calls;
  }

  function say(name: string, answer: string) {
    fireEvent.change(screen.getByRole("textbox", { name: `Answer for ${name}` }), {
      target: { value: answer },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit answer" }));
  }

  it("passes the phone on a valid answer and keeps it on a wrong one", async () => {
    const calls = await startTable();
    expect(calls[0]?.body).toEqual({ players: 2 });
    expect(screen.getByText("Ann, it's yours!")).toBeInTheDocument();

    say("Ann", "Carrot");
    expect(await screen.findByText("Not a valid answer. Try another.")).toBeInTheDocument();
    expect(screen.getByText("Ann, it's yours!")).toBeInTheDocument();

    say("Ann", "Apple");
    expect(await screen.findByText("Ben, it's yours!")).toBeInTheDocument();
    const answered = calls.filter((call) => call.url.endsWith("/answers"));
    expect(answered.at(-1)?.body).toEqual({ player: 0, answer: "Apple" });

    say("Ben", "apple");
    expect(await screen.findByText("Already said: Apple. Try another.")).toBeInTheDocument();
    expect(screen.getByText("Ben, it's yours!")).toBeInTheDocument();

    say("Ben", "Banan");
    fireEvent.click(await screen.findByRole("button", { name: "Banana" }));
    expect(await screen.findByText("Ann, it's yours!")).toBeInTheDocument();
  });

  it("puts out whoever holds it when the fuse goes off, and names the winner", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    await startTable();
    say("Ann", "Apple");
    await screen.findByText("Ben, it's yours!");

    await act(async () => {
      vi.advanceTimersByTime(FUSE_MAX_MS + 1000);
    });
    expect(await screen.findByText("Ben is out!")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "See who won" }));
    await waitFor(() => expect(screen.getByText("Ann wins!")).toBeInTheDocument());
  });
});
