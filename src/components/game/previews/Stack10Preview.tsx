import { createRun, place, type Stack10Run } from "@/lib/games/stack10";
import { t } from "@/lib/settings/language";
import { cn } from "@/lib/utils";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

export type Stack10Beat = Beat & {
  readonly columns: readonly (readonly number[])[];
  readonly next: number | null;
  /** The column the next tile is heading for. */
  readonly aiming: number | null;
  /** The column adding up to ten right now. */
  readonly clearing: number | null;
  readonly gain: number | null;
};

/** Its first tiles add up to tens quickly. Tiles come from the seed, as in a run. */
export const STACK10_PREVIEW_SEED = 22;
const PLACEMENTS = 7;

/** A clear when one is there; otherwise the fullest column it fits, as a player would. */
function choose(run: Stack10Run): number {
  const tile = run.nextTile as number;
  const sums = run.columns.map((column) => column.sum);
  const clears = sums.findIndex((sum) => sum + tile === 10);
  if (clears >= 0) return clears;
  const fits = sums
    .map((sum, column) => ({ sum, column }))
    .filter(({ sum }) => sum + tile < 10)
    .sort((a, b) => b.sum - a.sum);
  return fits.length > 0 ? fits[0].column : 0;
}

function build(): Stack10Beat[] {
  let run = createRun(STACK10_PREVIEW_SEED);
  const tiles = (r: Stack10Run) => r.columns.map((column) => column.tiles);
  const beats: Stack10Beat[] = [
    { ms: 300, columns: tiles(run), next: run.nextTile, aiming: null, clearing: null, gain: null },
  ];
  for (let placed = 0; placed < PLACEMENTS; placed += 1) {
    const column = choose(run);
    const tile = run.nextTile as number;
    const next = place(run, column);
    beats.push({
      ms: 170,
      columns: tiles(run),
      next: run.nextTile,
      aiming: column,
      clearing: null,
      gain: null,
    });
    const gain = next.score - run.score;
    const withTile = run.columns.map((c, index) =>
      index === column ? [...c.tiles, tile] : c.tiles,
    );
    beats.push({
      ms: gain > 0 ? 620 : 240,
      columns: withTile,
      next: next.nextTile,
      aiming: null,
      clearing: gain > 0 ? column : null,
      gain: gain > 0 ? gain : null,
    });
    run = next;
  }
  beats.push({
    ms: 260,
    columns: tiles(run),
    next: null,
    aiming: null,
    clearing: null,
    gain: null,
  });
  beats.push({
    ms: FADE_MS,
    columns: tiles(run),
    next: null,
    aiming: null,
    clearing: null,
    gain: null,
    fading: true,
  });
  return beats;
}

export const STACK10_PREVIEW_BEATS: readonly Stack10Beat[] = build();

/** Stack 10: tiles drop into columns, and a column that makes exactly ten clears. */
export function Stack10Preview({ playing }: { playing: boolean }) {
  const index = useBeats(STACK10_PREVIEW_BEATS, playing);
  const beat = STACK10_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="stack-10" fading={beat.fading} className="flex flex-col gap-[3%]">
      <div className="flex h-[17%] shrink-0 items-center justify-center gap-[3%]">
        <span className="text-[min(3.6cqw,3.6cqh,0.8rem)] text-muted-foreground">
          {t("Next tile")}
        </span>
        <span className="flex aspect-square h-full items-center justify-center rounded-xl bg-foreground text-[min(6.5cqw,6.5cqh,1.4rem)] font-semibold text-background tabular">
          {beat.next ?? "—"}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 gap-[2.5%]">
        {beat.columns.map((column, c) => (
          <div
            key={c}
            className={cn(
              "flex flex-1 flex-col items-center gap-[1%] rounded-xl border border-border bg-surface p-[2%] transition-colors duration-100",
              beat.aiming === c && "border-primary/60 bg-primary/10",
            )}
          >
            <div className="flex w-full min-h-0 flex-1 flex-col-reverse items-center gap-[3%]">
              {column.map((value, i) => (
                <span
                  key={i}
                  className={cn(
                    "flex aspect-square w-[78%] shrink-0 items-center justify-center rounded-lg text-[min(4cqw,4cqh,0.875rem)] font-semibold tabular",
                    i === column.length - 1
                      ? "preview-drop bg-foreground text-background"
                      : "bg-surface-2 text-foreground",
                    beat.clearing === c && "gridburst-pop",
                  )}
                >
                  {value}
                </span>
              ))}
            </div>
            <span className="text-[min(3.2cqw,3.2cqh,0.75rem)] text-muted-foreground tabular">
              {column.reduce((sum, value) => sum + value, 0)}
            </span>
          </div>
        ))}
      </div>
      {beat.gain !== null && <FloatingPoints key={index}>+{beat.gain}</FloatingPoints>}
    </PreviewStage>
  );
}
