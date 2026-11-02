import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSoundEnabled, setSoundEnabled, useGameSounds, type RunSoundState } from "@/lib/sound";

/** Records each note scheduled, by its frequency, so a cue can be identified. */
class FakeAudioContext {
  static notes: number[] = [];
  state = "running";
  currentTime = 0;
  destination = {};
  resume = () => Promise.resolve();
  createOscillator() {
    return {
      type: "sine",
      frequency: { setValueAtTime: (hz: number) => FakeAudioContext.notes.push(hz) },
      connect: (node: unknown) => node,
      start: () => {},
      stop: () => {},
    };
  }
  createGain() {
    const ramp = () => {};
    return {
      gain: { setValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
      connect: (node: unknown) => node,
    };
  }
}

const base: RunSoundState = { moves: 0, score: 0, cleared: 0, mistakes: 0, over: false };

function play(states: RunSoundState[]): number[] {
  const { rerender } = renderHook((state: RunSoundState) => useGameSounds(state), {
    initialProps: states[0]!,
  });
  for (const state of states.slice(1)) rerender(state);
  return FakeAudioContext.notes;
}

describe("useGameSounds", () => {
  beforeEach(() => {
    FakeAudioContext.notes = [];
    vi.stubGlobal("AudioContext", FakeAudioContext);
    setSoundEnabled(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("is silent on the first render", () => {
    expect(play([{ ...base, moves: 5, score: 40 }])).toEqual([]);
  });

  it("plays one cue per change, the most important one", () => {
    // A move that scores and clears plays the clear cue alone.
    expect(play([base, { ...base, moves: 1, score: 10, cleared: 1 }])).toEqual([659, 880, 1319]);
  });

  it("plays a tap for a move that does not score", () => {
    expect(play([base, { ...base, moves: 1 }])).toEqual([660]);
  });

  it("plays the ending once, and nothing after it", () => {
    expect(
      play([
        base,
        { ...base, moves: 1, over: true, ending: "stop" },
        { ...base, moves: 2, score: 5, over: true, ending: "stop" },
      ]),
    ).toEqual([523, 392]);
  });

  it("is silent for a fresh run", () => {
    expect(play([{ ...base, moves: 9, score: 90 }, base])).toEqual([]);
  });

  it("is silent while muted, and remembers the choice", () => {
    setSoundEnabled(false);
    expect(isSoundEnabled()).toBe(false);
    expect(localStorage.getItem("unbored-sound")).toBe("off");
    expect(play([base, { ...base, moves: 1 }])).toEqual([]);
  });
});
