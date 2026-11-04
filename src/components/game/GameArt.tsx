import { CascadeTile } from "@/components/game/CascadeTile";
import { ChessPiece } from "@/components/game/ChessPiece";
import { cn } from "@/lib/utils";

import { t } from "@/lib/settings/language";
const hueBg: Record<string, string> = {
  "game-1": "bg-game-1",
  "game-2": "bg-game-2",
  "game-3": "bg-game-3",
  "game-4": "bg-game-4",
  "game-5": "bg-game-5",
  "game-6": "bg-game-6",
  "game-7": "bg-game-7",
};

/** A hue token by name, with the brand colour as the fallback. */
export const hueClass = (hue: string) => hueBg[hue] ?? "bg-primary";

/**
 * The generated artwork for a game.
 *
 * `id` is the catalogue slug. It is a plain `string` rather than a union of known
 * games, because the catalogue is data: a game published tomorrow must render
 * *something* today, and a closed union would make that a type error. Each
 * known slug has its own board below; anything else falls through to a pattern
 * derived from the slug, so a new game is never a blank box and never a borrowed
 * game's art.
 *
 * Purely visual: no game logic runs here.
 *
 * The art scales to its box, not to the screen: the root is a size container, and
 * every board sits on the same square stage, sized in container units against
 * the *shorter* side (`min(…cqw, …cqh)`) and centred both ways. So a tall feed
 * card, a 4:5 Explore tile and a 96px thumbnail all show the whole picture, and
 * every game's picture is the same size in the same place.
 */
export function GameArt({
  id,
  className,
  live = false,
}: {
  id: string;
  className?: string;
  live?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center overflow-hidden bg-surface [container-type:size]",
        className,
      )}
      aria-hidden
    >
      {/* One stage for every game: a centred square, 70% of the shorter side,
          never larger than 18rem. Each picture fills it. */}
      <div className="flex aspect-square w-[min(70cqw,70cqh)] max-w-72 items-center justify-center">
        {id === "stack-10" && <Stack10 />}
        {id === "color-merge" && <ColorMerge />}
        {id === "dont-touch-the-black" && <BlackTiles live={live} />}
        {id === "one-move" && <OneMove />}
        {id === "dont-break-the-chain" && <Chain />}
        {id === "memory-flash" && <MemoryFlash />}
        {id === "7-second" && <Seven />}
        {id === "crowns" && <Crowns />}
        {id === "trail" && <Trail />}
        {id === "8-puzzle" && <EightPuzzle />}
        {id === "sun-and-moon" && <SunAndMoon />}
        {id === "sudoku" && <Sudoku />}
        {id === "mini-sudoku" && <MiniSudoku />}
        {id === "cascade" && <Cascade />}
        {id === "checkmate" && <Checkmate />}
        {id === "bolted" && <Bolted />}
        {id === "crossword" && <Crossword />}
        {id === "gridburst" && <Gridburst />}
        {id === "updraft" && <Updraft />}
        {id === "decant" && <Decant />}
        {id === "scatter" && <Scatter />}
        {id === "huedini" && <Huedini />}
        {!KNOWN.has(id) && <Generated seed={id} />}
      </div>
    </div>
  );
}

/** The slugs with bespoke art. Anything else gets the generated pattern. */
const KNOWN = new Set([
  "stack-10",
  "color-merge",
  "dont-touch-the-black",
  "one-move",
  "dont-break-the-chain",
  "memory-flash",
  "7-second",
  "crowns",
  "trail",
  "8-puzzle",
  "sun-and-moon",
  "sudoku",
  "mini-sudoku",
  "cascade",
  "checkmate",
  "bolted",
  "crossword",
  "gridburst",
  "updraft",
  "decant",
  "scatter",
  "huedini",
]);

/**
 * A stable pattern derived from the slug.
 *
 * Deterministic on purpose: the same game renders the same art on every screen
 * and across reloads, so it reads as identity rather than as noise.
 */
function Generated({ seed }: { seed: string }) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const cells = Array.from({ length: 16 }, (_, i) => {
    const bits = (hash >>> (i % 8)) & 0xff;
    return (bits + i * 37) % 3;
  });
  return (
    <div className="grid w-full grid-cols-4 gap-[min(2cqw,2cqh,0.5rem)]">
      {cells.map((shade, i) => (
        <div
          key={i}
          className={cn(
            "aspect-square rounded-md",
            shade === 0 && "bg-surface-2",
            shade === 1 && "bg-primary/40",
            shade === 2 && "bg-primary/80",
          )}
        />
      ))}
    </div>
  );
}

function Stack10() {
  const cols = [[3, 4, 2], [5, 1], [6, 2, 1], [7]];
  return (
    <div className="flex size-full items-end gap-[6%]">
      {cols.map((c, i) => (
        <div
          key={i}
          className="flex h-full flex-1 flex-col-reverse gap-[min(1.5cqw,0.375rem)] rounded-lg border border-glass-border p-[min(1.5cqw,0.375rem)]"
        >
          {c.map((n, j) => (
            <div
              key={j}
              className="flex aspect-square items-center justify-center rounded-md bg-game-1/80 font-mono text-[length:min(5cqw,1.125rem)] font-semibold text-background tabular"
            >
              {n}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function ColorMerge() {
  const o = [20, 45, 70, 100, 0, 45, 20, 70, 100, 70, 0, 20, 45, 20, 100, 45];
  return (
    <div className="grid w-full grid-cols-4 gap-[min(2cqw,2cqh,0.5rem)]">
      {o.map((v, i) => (
        <div
          key={i}
          className={cn(
            "aspect-square rounded-md",
            v === 0 ? "border border-glass-border" : "bg-game-2",
          )}
          style={{ opacity: v === 0 ? 1 : 0.25 + v / 135 }}
        />
      ))}
    </div>
  );
}

function BlackTiles({ live }: { live: boolean }) {
  const rows = [1, 3, 0, 2, 1, 3];
  return (
    <div className="grid size-full grid-rows-6 overflow-hidden rounded-xl">
      {rows.map((b, r) => (
        <div key={r} className="grid grid-cols-4 border-b border-background/40">
          {[0, 1, 2, 3].map((c) => (
            <div
              key={c}
              className={cn(
                "border-r border-background/40",
                c === b ? "bg-background" : "bg-game-3",
                live && r === 5 && c === b && "bg-primary",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function OneMove() {
  const cells = Array.from({ length: 25 }, (_, i) => i);
  const filled = new Set([6, 7, 8, 11, 13, 16, 17]);
  return (
    <div className="grid w-full grid-cols-5 gap-[min(1.5cqw,1.5cqh,0.375rem)]">
      {cells.map((i) => (
        <div
          key={i}
          className={cn(
            "aspect-square rounded-sm",
            filled.has(i)
              ? "bg-game-4"
              : i === 18
                ? "border-2 border-dashed border-game-4"
                : "bg-surface-2",
          )}
        />
      ))}
    </div>
  );
}

function Crowns() {
  // Seed 1's first board, solved: the regions read as shapes, and the Queens sit
  // one per row, column and region without touching.
  const regions = [0, 0, 0, 1, 1, 0, 0, 3, 1, 3, 2, 3, 3, 3, 3, 4, 4, 3, 3, 3, 4, 4, 4, 3, 3];
  const queens = new Set([1, 8, 10, 19, 22]);
  const fills = ["bg-game-1/50", "bg-game-2/50", "bg-game-4/50", "bg-game-6/50", "bg-game-5/50"];
  return (
    <div className="grid w-full grid-cols-5 gap-[min(1cqw,1cqh,0.25rem)]">
      {regions.map((region, i) => (
        <div
          key={i}
          className={cn("flex aspect-square items-center justify-center rounded-sm", fills[region])}
        >
          {queens.has(i) && <div className="size-1/2 rounded-full bg-foreground" />}
        </div>
      ))}
    </div>
  );
}

function Trail() {
  // Seed 1's first board, solved: one line through every cell, past its numbers.
  const path = [
    8, 7, 6, 5, 10, 15, 20, 21, 16, 11, 12, 17, 22, 23, 24, 19, 18, 13, 14, 9, 4, 3, 2, 1, 0,
  ];
  const numbers: Record<number, number> = { 8: 1, 6: 2, 16: 3, 12: 4, 24: 5, 14: 6, 2: 7, 0: 8 };
  return (
    <div className="relative aspect-square w-full">
      <svg viewBox="0 0 5 5" className="absolute inset-0 size-full">
        <rect width="5" height="5" rx="0.3" className="fill-surface-2" />
        <polyline
          points={path.map((c) => `${(c % 5) + 0.5},${Math.floor(c / 5) + 0.5}`).join(" ")}
          fill="none"
          className="stroke-game-7"
          strokeWidth={0.34}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {/* HTML rather than SVG text, so the digits stay centred on every browser. */}
      <div className="absolute inset-0 grid grid-cols-5 grid-rows-5 [container-type:inline-size]">
        {Object.entries(numbers).map(([cell, n]) => (
          <span
            key={cell}
            className="flex items-center justify-center"
            style={{ gridColumn: (+cell % 5) + 1, gridRow: Math.floor(+cell / 5) + 1 }}
          >
            <span className="flex aspect-square w-[56%] items-center justify-center rounded-full bg-foreground text-[6cqw] font-semibold leading-none text-background">
              {n}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function EightPuzzle() {
  // Nearly home: one slide from solved, the gap beside the last tile.
  const tiles = [1, 2, 3, 4, 5, 6, 7, 0, 8];
  return (
    <div className="grid w-full grid-cols-3 gap-[min(1.5cqw,1.5cqh,0.375rem)] rounded-xl bg-surface-2 p-[min(1.5cqw,1.5cqh,0.375rem)]">
      {tiles.map((tile, i) =>
        tile === 0 ? (
          <div key={i} className="aspect-square" />
        ) : (
          <div
            key={i}
            className={cn(
              "flex aspect-square items-center justify-center rounded-md text-[min(8cqw,8cqh,2rem)] font-semibold",
              tile === 8 ? "bg-game-1 text-background" : "bg-surface text-foreground",
            )}
          >
            {tile}
          </div>
        ),
      )}
    </div>
  );
}

function SunAndMoon() {
  // Seed 1's first board, solved: suns and moons, three of each in every line.
  const cells = "211221211221122112122121211212122112".split("").map(Number);
  return (
    <div className="grid w-full grid-cols-6 gap-[min(1cqw,1cqh,0.25rem)] rounded-xl bg-surface-2 p-[min(1.5cqw,1.5cqh,0.375rem)]">
      {cells.map((value, i) => (
        <div
          key={i}
          className="flex aspect-square items-center justify-center rounded-sm bg-surface"
        >
          <div
            className={cn(
              "size-1/2 rounded-full",
              value === 1
                ? "bg-game-4"
                : "bg-game-1 shadow-[inset_0.25em_-0.1em_0_0_var(--color-surface)]",
            )}
          />
        </div>
      ))}
    </div>
  );
}

function Bolted() {
  // Four bolts mid-sort: one locked, one taking a nut, two still mixed, the
  // lowest nuts face down.
  const bolts = [
    ["bg-game-5", "bg-game-5", "bg-game-5", "bg-game-5"],
    ["hidden", "bg-game-1", "bg-game-4"],
    ["hidden", "hidden", "bg-game-4", "bg-game-1"],
    ["bg-game-1"],
  ];
  return (
    <div className="flex size-full items-end justify-center gap-[min(4cqw,4cqh,1rem)] pb-[8%]">
      {bolts.map((nuts, b) => (
        <div
          key={b}
          className="relative flex h-[76%] w-[18%] flex-col-reverse items-center gap-[min(0.8cqw,0.8cqh,0.2rem)] pb-[min(2cqw,2cqh,0.5rem)]"
        >
          <div className="absolute inset-y-0 left-1/2 w-[18%] -translate-x-1/2 rounded-t-full bg-foreground/35" />
          <div className="absolute bottom-0 h-[min(1.5cqw,1.5cqh,0.375rem)] w-full rounded-full bg-foreground/25" />
          {nuts.map((tone, n) => (
            <div
              key={n}
              className={cn(
                "relative z-10 aspect-[48/20] w-full [clip-path:polygon(14%_0,86%_0,100%_50%,86%_100%,14%_100%,0_50%)]",
                tone === "hidden" ? "bg-surface-2" : tone,
                b === 3 && n === 0 && "-translate-y-[40%]",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Checkmate() {
  // A 5×5 corner of a board: the black king boxed in on the back rank, and the
  // white queen's mating square marked.
  const pieces: Record<number, string> = {
    1: "k",
    5: "p",
    6: "p",
    7: "p",
    13: "R",
    18: "K",
    22: "Q",
  };
  return (
    <div className="grid w-full grid-cols-5 overflow-hidden rounded-xl">
      {Array.from({ length: 25 }, (_, square) => {
        const dark = (Math.floor(square / 5) + (square % 5)) % 2 === 1;
        return (
          <div
            key={square}
            className={cn(
              "relative aspect-square p-[10%]",
              dark ? "bg-[oklch(0.58_0.06_250)]" : "bg-[oklch(0.86_0.015_250)]",
            )}
          >
            {square === 3 && <div className="absolute inset-[30%] rounded-full bg-primary/80" />}
            {pieces[square] && <ChessPiece piece={pieces[square]} />}
          </div>
        );
      })}
    </div>
  );
}

function Cascade() {
  // A 6×6 corner of a board mid-swap: three blue diamonds lined up down the
  // middle, about to clear, and a line tile and a burst waiting.
  const tiles = [
    [1, 2, 4, 3, 6, 5],
    [3, 5, 4, 1, 2, 6],
    [6, 1, 4, 5, 3, 2],
    [2, 9, 5, 2, 27, 1],
    [5, 3, 6, 1, 2, 4],
    [4, 6, 2, 3, 5, 1],
  ];
  return (
    <div className="grid w-full grid-cols-6 gap-[min(1cqw,1cqh,0.25rem)] rounded-xl bg-surface-2 p-[min(1.5cqw,1.5cqh,0.375rem)]">
      {tiles.flatMap((row, r) =>
        row.map((tile, c) => (
          <div
            key={r * 6 + c}
            className={cn(
              "aspect-square rounded-[min(1cqw,1cqh,0.25rem)] p-[12%]",
              c === 2 && r < 3
                ? "bg-foreground/15 ring-1 ring-inset ring-foreground/25"
                : "bg-surface",
            )}
          >
            <CascadeTile colour={tile % 8} special={Math.floor(tile / 8)} />
          </div>
        )),
      )}
    </div>
  );
}

function MiniSudoku() {
  // Seed 1's first board as it starts, box by box (two rows tall, three wide):
  // the givens, and one digit just placed.
  const cells = "000503530040006215210030400002623450".split("").map(Number);
  const boxes = Array.from({ length: 6 }, (_, box) =>
    Array.from({ length: 6 }, (_, index) => {
      const row = Math.floor(box / 2) * 2 + Math.floor(index / 3);
      const column = (box % 2) * 3 + (index % 3);
      return row * 6 + column;
    }),
  );
  return (
    <div className="grid w-full grid-cols-2 gap-[min(1cqw,1cqh,0.25rem)] rounded-xl bg-surface-2 p-[min(1cqw,1cqh,0.25rem)]">
      {boxes.map((box, b) => (
        <div key={b} className="grid grid-cols-3 gap-px overflow-hidden rounded-sm">
          {box.map((cell) => (
            <div
              key={cell}
              className={cn(
                "flex aspect-square items-center justify-center text-[min(3.5cqw,3.5cqh,0.85rem)] font-semibold leading-none",
                cell === 0 ? "bg-game-3 text-background" : "bg-surface text-foreground",
              )}
            >
              {cell === 0 ? 1 : cells[cell] || ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Sudoku() {
  // Seed 1's first board as it starts, box by box: the givens, and one digit just
  // placed.
  const cells = "730090000040130872000057049080610090000800600000003080178002904920004001060901250"
    .split("")
    .map(Number);
  const boxes = Array.from({ length: 9 }, (_, box) =>
    Array.from({ length: 9 }, (_, index) => {
      const row = Math.floor(box / 3) * 3 + Math.floor(index / 3);
      const column = (box % 3) * 3 + (index % 3);
      return row * 9 + column;
    }),
  );
  return (
    <div className="grid w-full grid-cols-3 gap-[min(1cqw,1cqh,0.25rem)] rounded-xl bg-surface-2 p-[min(1cqw,1cqh,0.25rem)]">
      {boxes.map((box, b) => (
        <div key={b} className="grid grid-cols-3 gap-px overflow-hidden rounded-sm">
          {box.map((cell) => (
            <div
              key={cell}
              className={cn(
                "flex aspect-square items-center justify-center text-[min(3cqw,3cqh,0.75rem)] font-semibold leading-none",
                cell === 2 ? "bg-game-3 text-background" : "bg-surface text-foreground",
              )}
            >
              {cell === 2 ? 2 : cells[cell] || ""}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Crossword() {
  // The mini for day 20000, solved: ARCH, WIRE, RAVEN, AREA, TERM across.
  const cells = "#ARCH" + "#WIRE" + "RAVEN" + "AREA#" + "TERM#";
  const numbers: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 6: 5, 10: 6, 15: 7, 20: 8 };
  return (
    <div className="grid w-full grid-cols-5 gap-px rounded-lg bg-foreground p-px">
      {[...cells].map((letter, i) =>
        letter === "#" ? (
          <div key={i} className="aspect-square bg-foreground" />
        ) : (
          <div
            key={i}
            className="relative flex aspect-square items-center justify-center bg-surface text-[min(6cqw,6cqh,1.5rem)] font-semibold"
          >
            {numbers[i] && (
              <span className="absolute left-[8%] top-[4%] text-[min(2.4cqw,2.4cqh,0.6rem)] font-medium text-muted-foreground">
                {numbers[i]}
              </span>
            )}
            {letter}
          </div>
        ),
      )}
    </div>
  );
}

function Gridburst() {
  // A board one placement from bursting: the bottom row is a square short, and
  // the piece about to land is outlined over the gap.
  const filled = new Set([
    9, 10, 17, 18, 19, 26, 21, 22, 29, 33, 34, 37, 38, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51, 52,
    54, 55, 56, 57, 58, 59, 60, 61, 63,
  ]);
  const landing = new Set([53, 62, 45]);
  const tones = ["bg-game-1", "bg-game-2", "bg-game-4", "bg-game-5", "bg-game-6", "bg-game-7"];
  return (
    <div className="grid w-full grid-cols-8 gap-[min(0.8cqw,0.8cqh,0.2rem)] rounded-lg bg-surface-2/60 p-[min(1cqw,1cqh,0.25rem)]">
      {Array.from({ length: 64 }, (_, cell) => (
        <div
          key={cell}
          className={cn(
            "aspect-square rounded-[min(0.8cqw,0.8cqh,0.2rem)]",
            filled.has(cell)
              ? tones[(cell * 7 + Math.floor(cell / 8)) % tones.length]
              : landing.has(cell)
                ? "border-2 border-primary bg-primary/30"
                : "bg-surface",
          )}
        />
      ))}
    </div>
  );
}

function Updraft() {
  // Two columns and the glider threading the first gap, rising.
  const columns = [
    { left: 18, top: 30, gap: 30 },
    { left: 62, top: 18, gap: 30 },
  ];
  return (
    <div className="relative size-full overflow-hidden rounded-xl bg-surface-2/60">
      {columns.map((column) => (
        <div key={column.left}>
          <div
            className="absolute top-0 w-[18%] rounded-b-md bg-game-2"
            style={{ left: `${column.left}%`, height: `${column.top}%` }}
          />
          <div
            className="absolute bottom-[10%] w-[18%] rounded-t-md bg-game-2"
            style={{ left: `${column.left}%`, top: `${column.top + column.gap}%` }}
          />
        </div>
      ))}
      <div className="absolute inset-x-0 bottom-0 h-[10%] bg-surface" />
      <div className="absolute top-[42%] left-[20%] aspect-square w-[14%] -rotate-12 rounded-full bg-primary ring-2 ring-background/40">
        <span className="absolute top-[22%] right-[14%] size-[30%] rounded-full bg-background" />
      </div>
    </div>
  );
}

function Decant() {
  // Five tubes mid-sort: one finished, one being poured into, two still mixed.
  const tubes = [
    ["bg-game-5", "bg-game-1", "bg-game-4", "bg-game-1"],
    ["bg-game-2", "bg-game-2", "bg-game-2", "bg-game-2"],
    ["bg-game-4", "bg-game-5", "bg-game-4"],
    ["bg-game-1", "bg-game-5"],
    ["bg-game-5", "bg-game-4", "bg-game-2", "bg-game-2"],
  ];
  return (
    <div className="flex size-full items-end justify-center gap-[min(3cqw,3cqh,0.75rem)] pb-[8%]">
      {tubes.map((units, t) => (
        <div
          key={t}
          className={cn(
            "flex h-[78%] w-[15%] flex-col-reverse gap-[min(0.6cqw,0.6cqh,0.15rem)] overflow-hidden rounded-t-[min(1cqw,1cqh,0.25rem)] rounded-b-full border-2 p-[min(0.6cqw,0.6cqh,0.15rem)]",
            t === 1 ? "border-success/70" : "border-foreground/20",
            t === 3 && "-translate-y-[8%] border-primary",
          )}
        >
          {units.map((tone, u) => (
            <div
              key={u}
              className={cn(
                "h-[calc(25%-2px)] w-full shrink-0",
                tone,
                u === 0 ? "rounded-b-full" : "rounded-[min(0.5cqw,0.5cqh,0.125rem)]",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function Scatter() {
  // A board mid-clear: arrows pointing every way, one turnstile, gaps where tiles left.
  const board = [0, 1, -1, 1, 2, 4, 3, -1, -1, 0, 6, 2, 3, -1, 0, 1];
  const arrows = ["↑", "→", "↓", "←"];
  return (
    <div className="grid aspect-square h-[78%] grid-cols-4 gap-[min(1.5cqw,1.5cqh,0.4rem)]">
      {board.map((tile, i) => (
        <div
          key={i}
          className={cn(
            "flex items-center justify-center rounded-[min(1.5cqw,1.5cqh,0.4rem)] text-[min(7cqw,7cqh,1.75rem)] font-bold leading-none",
            tile < 0
              ? "bg-foreground/5"
              : tile >= 4
                ? "border-2 border-game-7 bg-game-7/20 text-game-7"
                : "bg-foreground text-background",
          )}
        >
          {tile < 0 ? null : arrows[tile % 4]}
        </div>
      ))}
    </div>
  );
}

function Huedini() {
  // A 4×4 board in its frame: blocks lined up for their gates, one mid-escape.
  const blocks = [
    { r: 0, c: 0, h: 1, w: 2, hue: "oklch(0.64 0.21 25)" },
    { r: 1, c: 2, h: 2, w: 1, hue: "oklch(0.62 0.17 250)" },
    { r: 2, c: 0, h: 2, w: 2, hue: "oklch(0.86 0.17 95)" },
    { r: 3, c: 3, h: 1, w: 1, hue: "oklch(0.7 0.18 150)" },
  ];
  return (
    <div className="relative aspect-square h-[80%] rounded-[12%] bg-foreground/10">
      <span
        className="absolute left-[30%] top-[2%] h-[4%] w-[40%] rounded-full"
        style={{ backgroundColor: "oklch(0.62 0.17 250)" }}
      />
      <span
        className="absolute right-[2%] top-[56%] h-[22%] w-[4%] rounded-full"
        style={{ backgroundColor: "oklch(0.7 0.18 150)" }}
      />
      <span
        className="absolute bottom-[2%] left-[8%] h-[4%] w-[40%] rounded-full"
        style={{ backgroundColor: "oklch(0.86 0.17 95)" }}
      />
      <div className="absolute inset-[7%]">
        {blocks.map((b, i) => (
          <span
            key={i}
            className="absolute p-[3%]"
            style={{
              top: `${b.r * 25}%`,
              left: `${b.c * 25}%`,
              height: `${b.h * 25}%`,
              width: `${b.w * 25}%`,
            }}
          >
            <span
              className="huedini-face block size-full rounded-[18%]"
              style={{ ["--hue" as string]: b.hue }}
            />
          </span>
        ))}
      </div>
    </div>
  );
}

function Chain() {
  return (
    <div className="flex w-full flex-wrap items-center justify-center gap-[min(3cqw,3cqh,0.75rem)]">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className={cn(
            "size-[min(14cqw,14cqh,3.5rem)] rounded-full border-2 border-game-5",
            i < 5 && "bg-game-5",
            i === 5 && "bg-game-5/40",
          )}
        />
      ))}
    </div>
  );
}

function MemoryFlash() {
  const lit = new Set([0, 5, 6, 10, 15, 13]);
  return (
    <div className="grid w-full grid-cols-4 gap-[min(2cqw,2cqh,0.5rem)]">
      {Array.from({ length: 16 }, (_, i) => (
        <div
          key={i}
          className={cn("aspect-square rounded-md", lit.has(i) ? "bg-game-6" : "bg-surface-2")}
        />
      ))}
    </div>
  );
}

function Seven() {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-[min(2cqw,2cqh,0.5rem)] rounded-full border-[length:min(1.5cqw,1.5cqh,6px)] border-game-7/30">
      <span className="font-mono text-[length:min(15cqw,15cqh,3.75rem)] leading-none font-semibold text-game-7 tabular">
        7.00
      </span>
      {/* Only where there is room for it to be read: a thumbnail shows the dial. */}
      <span className="text-[length:min(3.5cqw,0.75rem)] font-medium whitespace-nowrap text-muted-foreground uppercase @max-[9rem]:hidden">
        {t("Daily challenge")}
      </span>
    </div>
  );
}
