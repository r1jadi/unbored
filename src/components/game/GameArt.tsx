import { cn } from "@/lib/utils";

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
 * every board is sized in container units against the *shorter* side
 * (`min(…cqw, …cqh)`), so a tall feed card, a 4:5 Explore tile and a 96px
 * thumbnail all show the whole picture rather than cropping it.
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
      {id === "stack-10" && <Stack10 />}
      {id === "color-merge" && <ColorMerge />}
      {id === "dont-touch-the-black" && <BlackTiles live={live} />}
      {id === "one-move" && <OneMove />}
      {id === "dont-break-the-chain" && <Chain />}
      {id === "memory-flash" && <MemoryFlash />}
      {id === "7-second" && <Seven />}
      {id === "queens" && <Queens />}
      {id === "zip" && <Zip />}
      {id === "8-puzzle" && <EightPuzzle />}
      {!KNOWN.has(id) && <Generated seed={id} />}
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
  "queens",
  "zip",
  "8-puzzle",
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
    <div className="grid w-[min(66cqw,66cqh)] max-w-72 grid-cols-4 gap-[min(2cqw,2cqh,0.5rem)]">
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
    <div className="flex h-[min(60cqh,75cqw)] w-[min(75cqw,80cqh)] items-end gap-[6%]">
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
    <div className="grid w-[min(75cqw,75cqh)] max-w-80 grid-cols-4 gap-[min(2cqw,2cqh,0.5rem)]">
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
    <div className="grid h-full w-full grid-rows-6">
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
    <div className="grid w-[min(66cqw,66cqh)] max-w-72 grid-cols-5 gap-[min(1.5cqw,1.5cqh,0.375rem)]">
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

function Queens() {
  // Seed 1's first board, solved: the regions read as shapes, and the Queens sit
  // one per row, column and region without touching.
  const regions = [0, 0, 0, 1, 1, 0, 0, 3, 1, 3, 2, 3, 3, 3, 3, 4, 4, 3, 3, 3, 4, 4, 4, 3, 3];
  const queens = new Set([1, 8, 10, 19, 22]);
  const fills = ["bg-game-1/50", "bg-game-2/50", "bg-game-4/50", "bg-game-6/50", "bg-game-5/50"];
  return (
    <div className="grid w-[min(66cqw,66cqh)] max-w-72 grid-cols-5 gap-[min(1cqw,1cqh,0.25rem)]">
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

function Zip() {
  // Seed 1's first board, solved: one line through every cell, past its numbers.
  const path = [
    8, 7, 6, 5, 10, 15, 20, 21, 16, 11, 12, 17, 22, 23, 24, 19, 18, 13, 14, 9, 4, 3, 2, 1, 0,
  ];
  const numbers: Record<number, number> = { 8: 1, 6: 2, 16: 3, 12: 4, 24: 5, 14: 6, 2: 7, 0: 8 };
  return (
    <div className="relative aspect-square w-[min(66cqw,66cqh)] max-w-72">
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
    <div className="grid w-[min(60cqw,60cqh)] max-w-64 grid-cols-3 gap-[min(1.5cqw,1.5cqh,0.375rem)] rounded-xl bg-surface-2 p-[min(1.5cqw,1.5cqh,0.375rem)]">
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

function Chain() {
  return (
    <div className="flex w-[min(75cqw,90cqh)] flex-wrap items-center justify-center gap-[min(3cqw,3cqh,0.75rem)]">
      {[1, 2, 3, 4, 5, 6, 7].map((i) => (
        <div
          key={i}
          className={cn(
            "size-[min(15cqw,18cqh,3rem)] rounded-full border-2 border-game-5",
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
    <div className="grid w-[min(66cqw,66cqh)] max-w-72 grid-cols-4 gap-[min(2cqw,2cqh,0.5rem)]">
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
    <div className="flex flex-col items-center gap-[min(3cqw,3cqh,0.75rem)]">
      <div className="flex size-[min(64cqw,56cqh,10rem)] items-center justify-center rounded-full border-[length:min(1.5cqw,1.5cqh,6px)] border-game-7/30">
        <span className="font-mono text-[length:min(15cqw,13cqh,3.75rem)] leading-none font-semibold text-game-7 tabular">
          7.00
        </span>
      </div>
      {/* Only where there is room for it to be read: a thumbnail shows the dial. */}
      <span className="text-[length:min(4cqw,0.75rem)] font-medium whitespace-nowrap text-muted-foreground uppercase @max-[9rem]:hidden">
        Daily challenge
      </span>
    </div>
  );
}
