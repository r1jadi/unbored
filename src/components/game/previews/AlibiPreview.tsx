import { Check, FolderClosed, FolderOpen } from "lucide-react";

import { cn } from "@/lib/utils";
import { t } from "@/lib/settings/language";

import { FADE_MS, FloatingPoints, PreviewStage, type Beat } from "./shared";
import { useBeats } from "./use-preview";

/**
 * A case of the preview's own, in no day's bank: three suspects, three files. Two
 * files open, the liar and the proof are picked, and the case closes. Two files
 * opened and a first-try solve is 100 − 2 × 8 = 84, 840 on screen.
 */
export const ALIBI_PREVIEW_SUSPECTS = ["The gardener", "The chef", "The guest"] as const;
export const ALIBI_PREVIEW_FILES = ["Bus ticket", "Door log", "Text message"] as const;
const CULPRIT = 1;
const PROOF = 1;

export type AlibiBeat = Beat & {
  readonly opened: readonly boolean[];
  readonly suspect: number | null;
  readonly file: number | null;
  readonly gain: number | null;
};

function build(): AlibiBeat[] {
  const none = [false, false, false];
  const beats: AlibiBeat[] = [
    { ms: 400, opened: none, suspect: null, file: null, gain: null },
    { ms: 500, opened: [true, false, false], suspect: null, file: null, gain: null },
    { ms: 600, opened: [true, true, false], suspect: null, file: null, gain: null },
    { ms: 500, opened: [true, true, false], suspect: CULPRIT, file: null, gain: null },
    { ms: 500, opened: [true, true, false], suspect: CULPRIT, file: PROOF, gain: null },
    { ms: 1100, opened: [true, true, false], suspect: CULPRIT, file: PROOF, gain: 840 },
  ];
  const end = beats[beats.length - 1]!;
  beats.push({ ...end, ms: FADE_MS, gain: null, fading: true });
  return beats;
}

export const ALIBI_PREVIEW_BEATS: readonly AlibiBeat[] = build();

/** Alibi: two files open, the liar and the proof are picked, case closed. */
export function AlibiPreview({ playing }: { playing: boolean }) {
  const index = useBeats(ALIBI_PREVIEW_BEATS, playing);
  const beat = ALIBI_PREVIEW_BEATS[index];
  return (
    <PreviewStage name="alibi" fading={beat.fading} className="flex items-center justify-center">
      <div className="flex w-full flex-col gap-[3cqw] p-[6cqw]">
        <div className="grid grid-cols-3 gap-[2cqw]">
          {ALIBI_PREVIEW_SUSPECTS.map((name, i) => (
            <div
              key={name}
              className={cn(
                "flex flex-col items-center gap-[1.5cqw] rounded-[min(2.5cqw,2.5cqh,0.6rem)] p-[2cqw] text-center text-[min(3.2cqw,3.2cqh,0.8rem)] font-medium transition-colors duration-200",
                beat.suspect === i ? "bg-foreground text-background" : "bg-surface-2",
              )}
            >
              <span
                className={cn(
                  "flex size-[min(10cqw,10cqh,2.5rem)] items-center justify-center rounded-full font-semibold",
                  beat.suspect === i ? "bg-background text-foreground" : "bg-surface",
                )}
              >
                {"?"}
              </span>
              <span className="truncate">{t(name)}</span>
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-[1.6cqw]">
          {ALIBI_PREVIEW_FILES.map((name, i) => {
            const opened = beat.opened[i];
            const Icon = opened ? FolderOpen : FolderClosed;
            return (
              <div
                key={name}
                className={cn(
                  "flex h-[min(10cqw,10cqh,2.5rem)] items-center gap-[2cqw] rounded-[min(2.5cqw,2.5cqh,0.6rem)] px-[3cqw] text-[min(3.6cqw,3.6cqh,0.9rem)] font-medium transition-colors duration-200",
                  beat.file === i
                    ? "bg-foreground text-background"
                    : opened
                      ? "bg-surface"
                      : "bg-surface-2 text-muted-foreground",
                )}
              >
                <Icon className="size-[min(4.5cqw,4.5cqh,1.1rem)] shrink-0" />
                <span className="flex-1 truncate">{t(name)}</span>
                {beat.gain !== null && beat.file === i && <Check className="size-[1em]" />}
              </div>
            );
          })}
        </div>
      </div>
      {beat.gain !== null && (
        <FloatingPoints key={index} note={t("Case closed!")}>
          +{beat.gain}
        </FloatingPoints>
      )}
    </PreviewStage>
  );
}
