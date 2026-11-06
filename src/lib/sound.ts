/**
 * Game sound effects, synthesised with the Web Audio API.
 *
 * There are no audio files: every cue is a few oscillator notes shaped by a
 * gain envelope, so sound costs nothing to download and works offline. Sound
 * is on by default and the choice is remembered on this device. Where Web
 * Audio is missing (the server, tests, old browsers) every call is a no-op.
 *
 * Games do not call `playSound` from their handlers; they report their run to
 * `useGameSounds` and the hook decides which cue a change deserves, so one
 * render plays at most one cue.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";

import { safeLocalStorage } from "@/lib/storage";

export type SoundCue =
  /** A move made: a tap, a placement, a letter. */
  | "tap"
  /** A move that earned points. */
  | "score"
  /** A line, round or level cleared. */
  | "clear"
  /** A wrong answer or a mistake the run survives. */
  | "error"
  /** The run solved its puzzle. */
  | "win"
  /** The run was lost: the board, the clock or a wrong tap ended it. */
  | "lose"
  /** The player ended the run themselves. */
  | "stop";

const STORAGE_KEY = "unbored-sound";

/** Notes as [frequency Hz, start s, length s]. */
type Note = readonly [number, number, number];

type Voice = { type: OscillatorType; volume: number; notes: readonly Note[] };

const VOICES: Record<SoundCue, Voice> = {
  tap: { type: "sine", volume: 0.12, notes: [[660, 0, 0.05]] },
  score: {
    type: "triangle",
    volume: 0.14,
    notes: [
      [784, 0, 0.07],
      [1047, 0.06, 0.1],
    ],
  },
  clear: {
    type: "triangle",
    volume: 0.16,
    notes: [
      [659, 0, 0.08],
      [880, 0.07, 0.08],
      [1319, 0.14, 0.16],
    ],
  },
  error: {
    type: "square",
    volume: 0.06,
    notes: [
      [220, 0, 0.08],
      [196, 0.09, 0.12],
    ],
  },
  win: {
    type: "triangle",
    volume: 0.16,
    notes: [
      [523, 0, 0.1],
      [659, 0.1, 0.1],
      [784, 0.2, 0.1],
      [1047, 0.3, 0.3],
    ],
  },
  lose: {
    type: "sawtooth",
    volume: 0.07,
    notes: [
      [392, 0, 0.14],
      [330, 0.14, 0.14],
      [262, 0.28, 0.3],
    ],
  },
  stop: {
    type: "sine",
    volume: 0.12,
    notes: [
      [523, 0, 0.1],
      [392, 0.1, 0.18],
    ],
  },
};

// ---- On/off, remembered on this device ----------------------------------

const listeners = new Set<() => void>();
let enabled: boolean | null = null;

function readEnabled(): boolean {
  if (enabled === null) {
    try {
      enabled = safeLocalStorage()?.getItem(STORAGE_KEY) !== "off";
    } catch {
      enabled = true;
    }
  }
  return enabled;
}

export function isSoundEnabled(): boolean {
  return readEnabled();
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    safeLocalStorage()?.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Best effort: the choice still holds for this visit.
  }
  if (next) unlock();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether sound is on, and a setter; re-renders when either changes anywhere. */
export function useSoundEnabled(): [boolean, (next: boolean) => void] {
  const on = useSyncExternalStore(subscribe, readEnabled, () => true);
  return [on, setSoundEnabled];
}

// ---- Playback ------------------------------------------------------------

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (context) return context;
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    context = new Ctor();
  } catch {
    return null;
  }
  return context;
}

/**
 * Browsers start audio suspended until a user gesture. Cues play from effects
 * that may run just outside the gesture, so the first gesture on the page
 * creates and resumes the context ahead of time.
 */
function unlock(): void {
  const ctx = audio();
  if (ctx && ctx.state === "suspended") void ctx.resume().catch(() => {});
}

if (typeof window !== "undefined") {
  const onGesture = () => {
    if (!readEnabled()) return;
    unlock();
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
  };
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
}

export function playSound(cue: SoundCue): void {
  if (!readEnabled()) return;
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  playVoice(ctx, VOICES[cue]);
}

/**
 * One note of a chain reaction, two semitones higher for each wave and levelling
 * off after two octaves, so a long chain keeps climbing without turning shrill.
 */
export function playChainNote(wave: number): void {
  if (!readEnabled()) return;
  const ctx = audio();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});

  const step = Math.min(Math.max(wave, 1) - 1, 12);
  const frequency = 392 * 2 ** ((step * 2) / 12);
  playVoice(ctx, { type: "triangle", volume: 0.14, notes: [[frequency, 0, 0.13]] });
}

function playVoice(ctx: AudioContext, voice: Voice): void {
  const now = ctx.currentTime;
  try {
    for (const [frequency, start, length] of voice.notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = voice.type;
      osc.frequency.setValueAtTime(frequency, now + start);
      // A fast attack and an exponential tail keep each note from clicking.
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(voice.volume, now + start + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + length + 0.02);
    }
  } catch {
    // A sound effect is never worth an error.
  }
}

// ---- Run → cue -----------------------------------------------------------

export type RunSoundState = {
  /** Moves made so far; a rise is a tap. */
  moves: number;
  /** The run's score; a rise is a scoring move. */
  score: number;
  /** Lines, rounds or levels cleared; a rise is a clear. */
  cleared?: number;
  /** Mistakes the run survived; a rise is an error. */
  mistakes?: number;
  /** Whether the run has ended. */
  over: boolean;
  /** How it ended, once `over`. Defaults to a loss. */
  ending?: "win" | "lose" | "stop";
};

/**
 * Plays the cue a change in the run deserves. The first render, a fresh run
 * (moves going down) and a board that mounts already over are silent.
 */
export function useGameSounds(state: RunSoundState): void {
  const previous = useRef<RunSoundState | null>(null);
  const { moves, score, cleared = 0, mistakes = 0, over, ending = "lose" } = state;

  useEffect(() => {
    const prev = previous.current;
    previous.current = { moves, score, cleared, mistakes, over, ending };
    if (!prev || moves < prev.moves) return;

    if (over && !prev.over) playSound(ending);
    else if (over) return;
    else if (cleared > (prev.cleared ?? 0)) playSound("clear");
    else if (mistakes > (prev.mistakes ?? 0)) playSound("error");
    else if (score > prev.score) playSound("score");
    else if (moves > prev.moves) playSound("tap");
  }, [moves, score, cleared, mistakes, over, ending]);
}
