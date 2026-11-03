import { describe, expect, it } from "vitest";

import {
  findMove,
  inCheck,
  isCheckmate,
  legalMoves,
  matingMoves,
  parseFen,
  perft,
  play,
  san,
  squareFrom,
  START_FEN,
  toFen,
} from "@/lib/games/chess";

const at = (fen: string, from: string, to: string) => {
  const position = parseFen(fen);
  const move = findMove(position, squareFrom(from), squareFrom(to));
  if (!move) throw new Error(`${from}${to} is not legal in ${fen}`);
  return { position, move };
};

describe("the move generator", () => {
  // The standard perft positions: the counts every correct generator agrees on.
  it("counts the starting position's tree", () => {
    const start = parseFen(START_FEN);
    expect([1, 2, 3].map((depth) => perft(start, depth))).toEqual([20, 400, 8902]);
  });

  it("counts Kiwipete: castling, pins, en passant and checks", () => {
    const kiwipete = parseFen(
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    );
    expect([1, 2].map((depth) => perft(kiwipete, depth))).toEqual([48, 2039]);
  });

  it("counts the rook endgame where en passant can expose a king", () => {
    const endgame = parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
    expect([1, 2, 3].map((depth) => perft(endgame, depth))).toEqual([14, 191, 2812]);
  });
});

describe("a position", () => {
  it("reads and writes FEN", () => {
    const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
    expect(toFen(parseFen(fen))).toBe(fen);
    expect(toFen(parseFen(START_FEN))).toBe(START_FEN);
  });

  it("castles, moving the rook and losing the rights", () => {
    const { position, move } = at("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1", "e1", "g1");
    const next = play(position, move);
    expect(toFen(next)).toBe("r3k2r/8/8/8/8/8/8/R4RK1 b kq - 1 1");
    expect(san(position, move)).toBe("O-O");
  });

  it("takes en passant, removing the pawn that passed", () => {
    const { position, move } = at("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", "e5", "d6");
    expect(toFen(play(position, move))).toBe("4k3/8/3P4/8/8/8/8/4K3 b - - 0 1");
    expect(san(position, move)).toBe("exd6");
  });

  it("promotes to a queen", () => {
    const { position, move } = at("8/4P3/8/8/8/8/k7/4K3 w - - 0 1", "e7", "e8");
    expect(play(position, move).board[squareFrom("e8")]).toBe("Q");
    expect(san(position, move)).toBe("e8=Q");
  });

  it("knows check from mate, and names the mate", () => {
    // Back-rank mate: Ra8 is mate, Ra7 is not even check.
    const fen = "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1";
    const position = parseFen(fen);
    const mates = matingMoves(position);
    expect(mates.map((m) => san(position, m))).toEqual(["Ra8#"]);
    const after = play(position, mates[0]);
    expect(inCheck(after)).toBe(true);
    expect(isCheckmate(after)).toBe(true);
    expect(legalMoves(after)).toHaveLength(0);
  });

  it("keeps a pinned piece where it is", () => {
    // The e-file rook pins the knight to its king: the knight has no legal moves.
    const position = parseFen("4k3/8/8/8/4n3/8/8/4RK2 b - - 0 1");
    expect(legalMoves(position).filter((m) => m.piece === "n")).toHaveLength(0);
  });
});
