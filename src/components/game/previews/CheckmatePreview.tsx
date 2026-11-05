import { ChessPiece } from "@/components/game/ChessPiece";
import { CHECKMATE_POINTS } from "@/lib/games/checkmate";
import {
  columnOf,
  findMove,
  isCheckmate,
  kingSquare,
  legalMoves,
  parseFen,
  play,
  rowOf,
  squareFrom,
} from "@/lib/games/chess";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/** A position of its own: mate in one on the back rank, not one of the bank's. */
export const CHECKMATE_PREVIEW_FEN = "6k1/1p3ppp/p7/n7/8/2N2Q2/PP3PPP/3R2K1 w - - 0 1";
const FROM = squareFrom("d1");
const TO = squareFrom("d8");

export const CHECKMATE_PREVIEW_START = parseFen(CHECKMATE_PREVIEW_FEN);
export const CHECKMATE_PREVIEW_MOVE = findMove(CHECKMATE_PREVIEW_START, FROM, TO);
const MATED = CHECKMATE_PREVIEW_MOVE
  ? play(CHECKMATE_PREVIEW_START, CHECKMATE_PREVIEW_MOVE)
  : CHECKMATE_PREVIEW_START;
export const CHECKMATE_PREVIEW_IS_MATE = isCheckmate(MATED);

const TARGETS = legalMoves(CHECKMATE_PREVIEW_START).filter((move) => move.from === FROM);

type Stage = "looking" | "picked" | "moved" | "mate";

export type CheckmateBeat = Beat & { readonly stage: Stage };

export const CHECKMATE_PREVIEW_BEATS: readonly CheckmateBeat[] = [
  { ms: 800, stage: "looking" },
  { ms: 800, stage: "picked" },
  { ms: 300, stage: "moved" },
  { ms: 1500, stage: "mate" },
  { ms: FADE_MS, stage: "mate", fading: true },
];

/** Every piece of the opening position, with where it stands. Keyed by its first square. */
const PIECES = CHECKMATE_PREVIEW_START.board.flatMap((piece, square) =>
  piece ? [{ piece, square }] : [],
);
const MATED_KING = kingSquare(MATED.board, "b");

const SQUARE = 100 / 8;

/** Checkmate: the mating move is found, and the king has nowhere left. */
export function CheckmatePreview({ playing }: { playing: boolean }) {
  const index = useBeats(CHECKMATE_PREVIEW_BEATS, playing);
  const beat = CHECKMATE_PREVIEW_BEATS[index];
  const moved = beat.stage === "moved" || beat.stage === "mate";
  return (
    <PreviewStage name="checkmate" fading={beat.fading}>
      <div className="absolute inset-0 grid grid-cols-8 grid-rows-8 overflow-hidden rounded-2xl">
        {Array.from({ length: 64 }, (_, square) => {
          const dark = (rowOf(square) + columnOf(square)) % 2 === 1;
          const target = beat.stage === "picked" && TARGETS.some((move) => move.to === square);
          return (
            <div
              key={square}
              className={cn(
                "relative",
                dark ? "bg-[oklch(0.58_0.06_250)]" : "bg-[oklch(0.86_0.015_250)]",
              )}
            >
              {moved && (square === FROM || square === TO) && (
                <span className="absolute inset-0 bg-primary/35" />
              )}
              {beat.stage === "picked" && square === FROM && (
                <span className="absolute inset-0 ring-4 ring-inset ring-primary" />
              )}
              {beat.stage === "mate" && square === MATED_KING && (
                <span className="absolute inset-0 bg-[radial-gradient(circle,oklch(0.63_0.22_25/0.85)_0%,transparent_70%)]" />
              )}
              {target && <span className="absolute inset-[36%] rounded-full bg-foreground/45" />}
            </div>
          );
        })}
      </div>
      {PIECES.map(({ piece, square }) => {
        const at = square === FROM && moved ? TO : square;
        return (
          <span
            key={square}
            className="absolute left-0 top-0 block transition-transform duration-[260ms] ease-out"
            style={{
              width: `${SQUARE}%`,
              height: `${SQUARE}%`,
              padding: `${SQUARE * 0.09}%`,
              transform: `translate(${columnOf(at) * 100}%, ${rowOf(at) * 100}%)`,
            }}
          >
            <ChessPiece piece={piece} />
          </span>
        );
      })}
      {beat.stage === "mate" && (
        <FloatingPoints key={index} top="top-[38%]">
          <span className="text-[min(7cqw,7cqh,1.75rem)]">Checkmate · +{CHECKMATE_POINTS[1]}</span>
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
