import type { CSSProperties } from "react";

import {
  decode,
  slide,
  type Direction,
  type HuediniBlock,
  type HuediniBoard,
  type HuediniGate,
} from "@/lib/games/huedini";
import { cn } from "@/lib/utils";

import { FADE_MS, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type HuediniBeat = Beat & {
  readonly blocks: readonly HuediniBlock[];
  /** The block on its way out, and the gate lit for it. */
  readonly leaving: { readonly id: number; readonly dir: Direction } | null;
  readonly gate: HuediniGate | null;
};

/** A board of its own, not one of the bank's: four blocks, a wall and their gates. */
export const HUEDINI_PREVIEW_CODE = `5|${["aa...", "...b.", "c..b.", "c.#..", "..dd."].join("")}|1234|101032323204`;

/** Each move as the block's id and the way it slides. */
export const HUEDINI_PREVIEW_MOVES: readonly (readonly [number, Direction])[] = [
  [0, 1],
  [1, 0],
  [2, 3],
  [3, 3],
  [3, 2],
];

const MOVE_MS = 440;

function build(): { board: HuediniBoard; beats: HuediniBeat[] } {
  const board = decode(HUEDINI_PREVIEW_CODE);
  let current = board;
  const still = { leaving: null, gate: null };
  const beats: HuediniBeat[] = [{ ...still, ms: 420, blocks: current.blocks }];
  HUEDINI_PREVIEW_MOVES.forEach(([id, dir]) => {
    const block = current.blocks.find((candidate) => candidate.id === id) as HuediniBlock;
    const result = slide(current, block, dir);
    if (!result) return;
    if (result.kind === "stop") {
      const blocks = current.blocks.map((other) =>
        other.id === id ? { ...other, r: result.r, c: result.c } : other,
      );
      beats.push({ ...still, ms: MOVE_MS, blocks });
      current = { ...current, blocks };
    } else {
      beats.push({
        ms: MOVE_MS,
        blocks: current.blocks,
        leaving: { id, dir },
        gate: result.gate,
      });
      current = { ...current, blocks: current.blocks.filter((other) => other.id !== id) };
      beats.push({ ...still, ms: 90, blocks: current.blocks });
    }
  });
  beats.push({ ...still, ms: 560, blocks: current.blocks });
  beats.push({ ...still, ms: FADE_MS, blocks: current.blocks, fading: true });
  return { board, beats };
}

const SCRIPT = build();
export const HUEDINI_PREVIEW_BOARD = SCRIPT.board;
export const HUEDINI_PREVIEW_BEATS: readonly HuediniBeat[] = SCRIPT.beats;

const HUES = [
  "oklch(0.64 0.21 25)",
  "oklch(0.75 0.17 60)",
  "oklch(0.86 0.17 95)",
  "oklch(0.7 0.18 150)",
  "oklch(0.62 0.17 250)",
  "oklch(0.6 0.2 310)",
];

const FRAME = 4.5;
const INNER = 91;
const OFF_BOARD = [
  ["0", "-90%"],
  ["90%", "0"],
  ["0", "90%"],
  ["-90%", "0"],
] as const;

function gateStyle(gate: HuediniGate, side: number): CSSProperties {
  const along = FRAME + ((gate.start + 0.08) / side) * INNER;
  const length = (1.84 / side) * INNER;
  const horizontal = gate.edge === 0 || gate.edge === 2;
  const fill = HUES[gate.colour - 1];
  return {
    backgroundColor: fill,
    boxShadow: `0 0 12px -2px ${fill}`,
    ...(horizontal
      ? {
          left: `${along}%`,
          width: `${length}%`,
          height: `${FRAME * 0.62}%`,
          [gate.edge === 0 ? "top" : "bottom"]: `${FRAME * 0.19}%`,
        }
      : {
          top: `${along}%`,
          height: `${length}%`,
          width: `${FRAME * 0.62}%`,
          [gate.edge === 3 ? "left" : "right"]: `${FRAME * 0.19}%`,
        }),
  };
}

/** Huedini: blocks slide until they stop, or out through the gate of their colour. */
export function HuediniPreview({ playing }: { playing: boolean }) {
  const index = useBeats(HUEDINI_PREVIEW_BEATS, playing);
  const beat = HUEDINI_PREVIEW_BEATS[index];
  const { side, walls, gates } = HUEDINI_PREVIEW_BOARD;
  const pct = (cells: number) => `${(cells / side) * 100}%`;
  return (
    <PreviewStage name="huedini" fading={beat.fading}>
      <div className="absolute inset-0 rounded-[9%] bg-foreground/10">
        {gates.map((gate) => (
          <span
            key={`${gate.edge}:${gate.start}`}
            className={cn(
              "absolute rounded-full",
              beat.gate?.edge === gate.edge &&
                beat.gate.start === gate.start &&
                "huedini-gate-flash",
            )}
            style={gateStyle(gate, side)}
          />
        ))}
        <div className="absolute inset-[4.5%]">
          {Array.from({ length: side * side }, (_, cell) => (
            <div
              key={cell}
              className="absolute p-[1.2%]"
              style={{
                left: pct(cell % side),
                top: pct(Math.floor(cell / side)),
                width: pct(1),
                height: pct(1),
              }}
            >
              <div
                className={cn(
                  "size-full rounded-[22%]",
                  walls.includes(cell) ? "huedini-wall" : "bg-surface-2/45",
                )}
              />
            </div>
          ))}
          {beat.blocks.map((block) => {
            const leaving = beat.leaving?.id === block.id ? beat.leaving : null;
            return (
              <div
                key={block.id}
                className={cn(
                  "huedini-block absolute z-10 p-[0.8%]",
                  leaving && "preview-leave [animation-duration:420ms]",
                )}
                style={
                  {
                    top: pct(block.r),
                    left: pct(block.c),
                    width: pct(block.w),
                    height: pct(block.h),
                    transitionDuration: `${MOVE_MS - 60}ms`,
                    "--hue": HUES[block.colour - 1],
                    ...(leaving
                      ? {
                          "--to-x": OFF_BOARD[leaving.dir][0],
                          "--to-y": OFF_BOARD[leaving.dir][1],
                        }
                      : {}),
                  } as CSSProperties
                }
              >
                <span className="huedini-face block size-full rounded-[18%]" />
              </div>
            );
          })}
        </div>
      </div>
    </PreviewStage>
  );
}
