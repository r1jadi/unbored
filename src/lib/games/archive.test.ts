import { afterEach, describe, expect, it, vi } from "vitest";

import {
  archiveDays,
  archiveSeed,
  isArchiveDay,
  releaseArchiveDay,
  setArchiveDay,
} from "./archive";
import { offlineResultNote, practiceLabel } from "./offline";
import { startSession } from "./sessions";

afterEach(() => {
  setArchiveDay(null);
  vi.useRealTimers();
});

describe("the daily puzzle archive", () => {
  it("deals each daily game's seed for a day, and nothing for other games", () => {
    expect(archiveSeed("crossword@1", 20_400)).toBe("20400");
    expect(archiveSeed("gjeje@1", 20_400)).toBe("20400");
    expect(archiveSeed("seven-second@1", 20_400)).toBe(String(20_400n * 2_654_435_761n + 7n));
    expect(archiveSeed("sudoku@4", 20_400)).toBeNull();
  });

  it("offers only the 30 days before today", () => {
    const today = 20_403;
    expect(isArchiveDay(today, today)).toBe(false);
    expect(isArchiveDay(today + 1, today)).toBe(false);
    expect(isArchiveDay(today - 1, today)).toBe(true);
    expect(isArchiveDay(today - 30, today)).toBe(true);
    expect(isArchiveDay(today - 31, today)).toBe(false);
    expect(archiveDays(today)).toHaveLength(30);
    expect(archiveDays(today)[0]).toBe(today - 1);
  });

  it("starts a past day as practice, without asking the server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    setArchiveDay(20_400);

    const session = await startSession("guesswork", { rulesVersion: "guesswork@1" });

    expect(session).toMatchObject({ seed: "20400", ranked: false, offline: true });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(practiceLabel()).toBe("Past puzzle · practice");
    expect(offlineResultNote()).toContain("Today's puzzle is the one that counts.");
    fetchSpy.mockRestore();
  });

  it("lets go a tick after the play screen leaves", () => {
    vi.useFakeTimers();
    setArchiveDay(20_400);
    releaseArchiveDay();
    // Set again straight away, as a remount does: the day survives.
    setArchiveDay(20_400);
    vi.runAllTimers();
    expect(practiceLabel()).toBe("Past puzzle · practice");

    releaseArchiveDay();
    vi.runAllTimers();
    expect(practiceLabel()).toBe("Offline practice");
  });
});
