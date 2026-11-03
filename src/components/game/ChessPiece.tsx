import {
  ChessBishop,
  ChessKing,
  ChessKnight,
  ChessPawn,
  ChessQueen,
  ChessRook,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

const ICONS: Record<string, LucideIcon> = {
  p: ChessPawn,
  n: ChessKnight,
  b: ChessBishop,
  r: ChessRook,
  q: ChessQueen,
  k: ChessKing,
};

/** What a screen reader says for a piece. */
export const PIECE_NAMES: Record<string, string> = {
  p: "pawn",
  n: "knight",
  b: "bishop",
  r: "rook",
  q: "queen",
  k: "king",
};

/**
 * A chess piece: the app's own icon set, filled solid. White pieces are light
 * with a dark outline. Black pieces are dark through and through, outline
 * included, because some of the icons are open strokes that a fill alone would
 * leave pale; a thin light edge keeps them clear of the dark squares.
 * `piece` is a FEN letter. Purely visual.
 */
export function ChessPiece({ piece, className }: { piece: string; className?: string }) {
  const Icon = ICONS[piece.toLowerCase()];
  if (!Icon) return null;
  const white = piece === piece.toUpperCase();
  return (
    <Icon
      aria-hidden
      strokeWidth={1.6}
      className={cn(
        "block size-full",
        white
          ? "fill-[oklch(0.98_0.005_85)] text-[oklch(0.25_0.01_270)] drop-shadow-[0_1px_0_oklch(0_0_0/0.25)]"
          : "fill-[oklch(0.22_0.012_270)] text-[oklch(0.22_0.012_270)] drop-shadow-[0_0_1px_oklch(0.97_0_0/0.9)]",
        className,
      )}
    />
  );
}
