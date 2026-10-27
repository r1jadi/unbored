/**
 * Sudoku pencil notes: the small candidate digits a player jots in an empty cell.
 *
 * Notes are the player's own working, so they live only on the screen: they are
 * never a move, never submitted, and never verified. A cell's notes are a bit
 * mask — bit `d` set means `d` is noted — so a board's notes are 81 numbers.
 */
import { peers } from "@/lib/games/sudoku";

export type SudokuNotes = readonly number[];

/** A board with no notes. */
export function emptyNotes(): SudokuNotes {
  return new Array<number>(81).fill(0);
}

/** The digits noted in a cell, in order. */
export function notedDigits(mask: number): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((digit) => mask & (1 << digit));
}

/** Notes `digit` in a cell, or takes it out if it is there. */
export function toggleNote(notes: SudokuNotes, cell: number, digit: number): SudokuNotes {
  const next = [...notes];
  next[cell] ^= 1 << digit;
  return next;
}

/** Every note in a cell, gone. */
export function clearNotes(notes: SudokuNotes, cell: number): SudokuNotes {
  if (!notes[cell]) return notes;
  const next = [...notes];
  next[cell] = 0;
  return next;
}

/** One step Undo can take back: the notes before it, and a digit placed, if any. */
export type SudokuUndoStep = {
  readonly notes: SudokuNotes;
  /** For a placed digit: the cell, and what it held before. */
  readonly cell?: number;
  readonly previous?: number;
};

/** A board's notes and what Undo can step back through. */
export type SudokuNotesState = {
  readonly notes: SudokuNotes;
  readonly history: readonly SudokuUndoStep[];
};

export type SudokuNotesAction =
  | { type: "toggle"; cell: number; digit: number }
  | { type: "clear"; cell: number }
  | { type: "place"; cell: number; digit: number; previous: number }
  | { type: "undo" }
  | { type: "reset" };

export const emptyNotesState = (): SudokuNotesState => ({ notes: emptyNotes(), history: [] });

/**
 * Notes and Undo, as a reducer: every change builds on the latest state, so taps
 * in quick succession never overwrite one another. A change that changes nothing
 * leaves no step to undo.
 */
export function notesReducer(state: SudokuNotesState, action: SudokuNotesAction): SudokuNotesState {
  switch (action.type) {
    case "toggle":
      return {
        notes: toggleNote(state.notes, action.cell, action.digit),
        history: [...state.history, { notes: state.notes }],
      };
    case "clear":
      if (!state.notes[action.cell]) return state;
      return {
        notes: clearNotes(state.notes, action.cell),
        history: [...state.history, { notes: state.notes }],
      };
    case "place":
      return {
        notes:
          action.digit === 0 ? state.notes : afterPlacing(state.notes, action.cell, action.digit),
        history: [
          ...state.history,
          { notes: state.notes, cell: action.cell, previous: action.previous },
        ],
      };
    case "undo": {
      const step = state.history[state.history.length - 1];
      if (!step) return state;
      return { notes: step.notes, history: state.history.slice(0, -1) };
    }
    case "reset":
      return emptyNotesState();
  }
}

/**
 * The notes once `digit` is placed in `cell`: the cell's own notes go, and the
 * digit comes out of the notes of every cell in its row, column and box — it
 * can no longer go there.
 */
export function afterPlacing(notes: SudokuNotes, cell: number, digit: number): SudokuNotes {
  const next = [...notes];
  next[cell] = 0;
  for (const other of peers(cell)) next[other] &= ~(1 << digit);
  return next;
}
