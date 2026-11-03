/**
 * Chess rules, as a small pure module: positions, legal moves, check and mate.
 *
 * Checkmate (`checkmate.ts`) plays puzzles from a bank, and the bank's generator
 * (`scripts/generate-checkmate-bank.mjs`) finds them with this module, so it has
 * no imports and uses only syntax Node can run with its type stripping.
 *
 * A square is `row × 8 + column`, row 0 the eighth rank and column 0 the a-file,
 * so the board reads in FEN order. A piece is a FEN letter: `PNBRQK` white and
 * `pnbrqk` black; an empty square is `""`. Promotion is always to a queen: the
 * puzzles never need another piece, so a move is just its two squares.
 */

export type Colour = "w" | "b";

export type Position = {
  /** 64 squares, FEN order. */
  readonly board: readonly string[];
  readonly turn: Colour;
  /** Castling rights, as FEN writes them: some of `KQkq`, or `""`. */
  readonly castling: string;
  /** The square a pawn may capture en passant onto, or -1. */
  readonly ep: number;
  readonly halfmove: number;
  readonly fullmove: number;
};

export type Move = {
  readonly from: number;
  readonly to: number;
  readonly piece: string;
  /** What the move takes, if anything (the pawn, for en passant). */
  readonly captured: string;
  readonly promotion: boolean;
  readonly castle: boolean;
  readonly enPassant: boolean;
};

const FILES = "abcdefgh";

export const rowOf = (square: number): number => Math.floor(square / 8);
export const columnOf = (square: number): number => square % 8;
export const colourOf = (piece: string): Colour | null =>
  piece === "" ? null : piece === piece.toUpperCase() ? "w" : "b";
const other = (colour: Colour): Colour => (colour === "w" ? "b" : "w");
const on = (row: number, column: number) => row >= 0 && row < 8 && column >= 0 && column < 8;

/** A square's name: `e4`. */
export function squareName(square: number): string {
  return `${FILES[columnOf(square)]}${8 - rowOf(square)}`;
}

/** A square from its name, or -1. */
export function squareFrom(name: string): number {
  const column = FILES.indexOf(name[0]);
  const rank = Number(name[1]);
  if (column < 0 || !(rank >= 1 && rank <= 8) || name.length !== 2) return -1;
  return (8 - rank) * 8 + column;
}

/** A move's number in a submission: `from × 64 + to`. */
export const encodeMove = (from: number, to: number): number => from * 64 + to;

/** A move as UCI writes it: `e2e4`, `e7e8q`. */
export const uci = (move: Move): string =>
  `${squareName(move.from)}${squareName(move.to)}${move.promotion ? "q" : ""}`;

export function parseFen(fen: string): Position {
  const [placement, turn, castling, ep, halfmove, fullmove] = fen.trim().split(/\s+/);
  const board: string[] = [];
  for (const row of placement.split("/")) {
    for (const char of row) {
      if (/\d/.test(char)) for (let i = 0; i < Number(char); i += 1) board.push("");
      else board.push(char);
    }
  }
  if (board.length !== 64 || (turn !== "w" && turn !== "b")) {
    throw new TypeError(`not a FEN position: ${fen}`);
  }
  return {
    board,
    turn,
    castling: castling && castling !== "-" ? castling : "",
    ep: ep && ep !== "-" ? squareFrom(ep) : -1,
    halfmove: Number(halfmove ?? 0) || 0,
    fullmove: Number(fullmove ?? 1) || 1,
  };
}

export function toFen(position: Position): string {
  const rows: string[] = [];
  for (let row = 0; row < 8; row += 1) {
    let text = "";
    let empty = 0;
    for (let column = 0; column < 8; column += 1) {
      const piece = position.board[row * 8 + column];
      if (piece === "") {
        empty += 1;
        continue;
      }
      if (empty) text += String(empty);
      empty = 0;
      text += piece;
    }
    if (empty) text += String(empty);
    rows.push(text);
  }
  return [
    rows.join("/"),
    position.turn,
    position.castling || "-",
    position.ep >= 0 ? squareName(position.ep) : "-",
    position.halfmove,
    position.fullmove,
  ].join(" ");
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const KNIGHT = [
  [-2, -1],
  [-2, 1],
  [-1, -2],
  [-1, 2],
  [1, -2],
  [1, 2],
  [2, -1],
  [2, 1],
];
const KING = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
];
const DIAGONAL = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
const STRAIGHT = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/** Whether `by` attacks `square` on this board. */
export function attacked(board: readonly string[], square: number, by: Colour): boolean {
  const row = rowOf(square);
  const column = columnOf(square);
  const own = (piece: string) => (by === "w" ? piece.toUpperCase() : piece.toLowerCase());
  // A white pawn attacks up the board (towards row 0), so it sits a row below.
  const pawnRow = by === "w" ? row + 1 : row - 1;
  for (const dc of [-1, 1]) {
    if (on(pawnRow, column + dc) && board[pawnRow * 8 + column + dc] === own("p")) return true;
  }
  for (const [dr, dc] of KNIGHT) {
    if (on(row + dr, column + dc) && board[(row + dr) * 8 + column + dc] === own("n")) return true;
  }
  for (const [dr, dc] of KING) {
    if (on(row + dr, column + dc) && board[(row + dr) * 8 + column + dc] === own("k")) return true;
  }
  const slide = (directions: number[][], pieces: string[]) => {
    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = column + dc;
      while (on(r, c)) {
        const piece = board[r * 8 + c];
        if (piece !== "") {
          if (pieces.includes(piece)) return true;
          break;
        }
        r += dr;
        c += dc;
      }
    }
    return false;
  };
  return slide(DIAGONAL, [own("b"), own("q")]) || slide(STRAIGHT, [own("r"), own("q")]);
}

export function kingSquare(board: readonly string[], colour: Colour): number {
  return board.indexOf(colour === "w" ? "K" : "k");
}

/** Whether the side to move is in check. */
export function inCheck(position: Position): boolean {
  const king = kingSquare(position.board, position.turn);
  return king >= 0 && attacked(position.board, king, other(position.turn));
}

/** Every move the side to move could make, before checking it leaves its king safe. */
function pseudoMoves(position: Position): Move[] {
  const { board, turn } = position;
  const moves: Move[] = [];
  const add = (from: number, to: number, extra: Partial<Move> = {}) =>
    moves.push({
      from,
      to,
      piece: board[from],
      captured: board[to],
      promotion: false,
      castle: false,
      enPassant: false,
      ...extra,
    });

  for (let from = 0; from < 64; from += 1) {
    const piece = board[from];
    if (colourOf(piece) !== turn) continue;
    const row = rowOf(from);
    const column = columnOf(from);
    const kind = piece.toLowerCase();

    if (kind === "p") {
      const step = turn === "w" ? -1 : 1;
      const startRow = turn === "w" ? 6 : 1;
      const lastRow = turn === "w" ? 0 : 7;
      const ahead = row + step;
      if (on(ahead, column) && board[ahead * 8 + column] === "") {
        add(from, ahead * 8 + column, { promotion: ahead === lastRow });
        const two = row + 2 * step;
        if (row === startRow && board[two * 8 + column] === "") add(from, two * 8 + column);
      }
      for (const dc of [-1, 1]) {
        if (!on(ahead, column + dc)) continue;
        const to = ahead * 8 + column + dc;
        const target = board[to];
        if (target !== "" && colourOf(target) !== turn) {
          add(from, to, { promotion: ahead === lastRow });
        } else if (to === position.ep) {
          add(from, to, { captured: turn === "w" ? "p" : "P", enPassant: true });
        }
      }
      continue;
    }

    if (kind === "n" || kind === "k") {
      for (const [dr, dc] of kind === "n" ? KNIGHT : KING) {
        if (!on(row + dr, column + dc)) continue;
        const to = (row + dr) * 8 + column + dc;
        if (colourOf(board[to]) !== turn) add(from, to);
      }
      if (kind === "k") {
        // Castling: the rights, an empty path, and no attacked square on the king's way.
        const home = turn === "w" ? 60 : 4;
        const enemy = other(turn);
        if (from === home && !attacked(board, home, enemy)) {
          const [kingSide, queenSide] = turn === "w" ? ["K", "Q"] : ["k", "q"];
          if (
            position.castling.includes(kingSide) &&
            board[home + 1] === "" &&
            board[home + 2] === "" &&
            !attacked(board, home + 1, enemy) &&
            !attacked(board, home + 2, enemy)
          ) {
            add(from, home + 2, { castle: true });
          }
          if (
            position.castling.includes(queenSide) &&
            board[home - 1] === "" &&
            board[home - 2] === "" &&
            board[home - 3] === "" &&
            !attacked(board, home - 1, enemy) &&
            !attacked(board, home - 2, enemy)
          ) {
            add(from, home - 2, { castle: true });
          }
        }
      }
      continue;
    }

    const directions =
      kind === "b" ? DIAGONAL : kind === "r" ? STRAIGHT : [...DIAGONAL, ...STRAIGHT];
    for (const [dr, dc] of directions) {
      let r = row + dr;
      let c = column + dc;
      while (on(r, c)) {
        const to = r * 8 + c;
        const target = board[to];
        if (target === "") {
          add(from, to);
        } else {
          if (colourOf(target) !== turn) add(from, to);
          break;
        }
        r += dr;
        c += dc;
      }
    }
  }
  return moves;
}

const CORNER_RIGHTS: Record<number, string> = { 63: "K", 56: "Q", 7: "k", 0: "q" };

/** The position after a move. Assumes the move came from `legalMoves`. */
export function play(position: Position, move: Move): Position {
  const board = [...position.board];
  const { from, to } = move;
  board[to] = move.promotion ? (position.turn === "w" ? "Q" : "q") : board[from];
  board[from] = "";
  if (move.enPassant) board[rowOf(from) * 8 + columnOf(to)] = "";
  if (move.castle) {
    const kingSide = to > from;
    const rookFrom = kingSide ? from + 3 : from - 4;
    const rookTo = kingSide ? from + 1 : from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = "";
  }

  let castling = position.castling;
  if (move.piece === "K") castling = castling.replace("K", "").replace("Q", "");
  if (move.piece === "k") castling = castling.replace("k", "").replace("q", "");
  for (const square of [from, to]) {
    const right = CORNER_RIGHTS[square];
    if (right) castling = castling.replace(right, "");
  }

  const pawn = move.piece.toLowerCase() === "p";
  return {
    board,
    turn: other(position.turn),
    castling,
    ep: pawn && Math.abs(to - from) === 16 ? (from + to) / 2 : -1,
    halfmove: pawn || move.captured !== "" ? 0 : position.halfmove + 1,
    fullmove: position.fullmove + (position.turn === "b" ? 1 : 0),
  };
}

/** Every legal move for the side to move. */
export function legalMoves(position: Position): Move[] {
  return pseudoMoves(position).filter((move) => {
    const next = play(position, move);
    const king = kingSquare(next.board, position.turn);
    return king >= 0 && !attacked(next.board, king, next.turn);
  });
}

/** The legal move between two squares, or null. */
export function findMove(position: Position, from: number, to: number): Move | null {
  return legalMoves(position).find((move) => move.from === from && move.to === to) ?? null;
}

export function isCheckmate(position: Position): boolean {
  return inCheck(position) && legalMoves(position).length === 0;
}

/** Every move that mates at once. */
export function matingMoves(position: Position): Move[] {
  return legalMoves(position).filter((move) => isCheckmate(play(position, move)));
}

/** A move as a player reads it: `Qxh7#`, `exd6`, `O-O`, `e8=Q+`. */
export function san(position: Position, move: Move): string {
  const next = play(position, move);
  const suffix = isCheckmate(next) ? "#" : inCheck(next) ? "+" : "";
  if (move.castle) return (move.to > move.from ? "O-O" : "O-O-O") + suffix;
  const kind = move.piece.toUpperCase();
  const capture = move.captured !== "";
  if (kind === "P") {
    const from = capture ? `${FILES[columnOf(move.from)]}x` : "";
    return `${from}${squareName(move.to)}${move.promotion ? "=Q" : ""}${suffix}`;
  }
  // Disambiguate by file, then rank, then both, as the rules of notation do.
  const rivals = legalMoves(position).filter(
    (m) => m.to === move.to && m.piece === move.piece && m.from !== move.from,
  );
  let which = "";
  if (rivals.length) {
    const sameFile = rivals.some((m) => columnOf(m.from) === columnOf(move.from));
    const sameRank = rivals.some((m) => rowOf(m.from) === rowOf(move.from));
    const name = squareName(move.from);
    which = !sameFile ? name[0] : !sameRank ? name[1] : name;
  }
  return `${kind}${which}${capture ? "x" : ""}${squareName(move.to)}${suffix}`;
}

/** How many positions lie `depth` moves ahead: the standard check on a move generator. */
export function perft(position: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(position);
  if (depth === 1) return moves.length;
  let count = 0;
  for (const move of moves) count += perft(play(position, move), depth - 1);
  return count;
}
