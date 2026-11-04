import { points } from "@/lib/format";
import { t } from "@/lib/settings/language";
import { useMyBestScore } from "@/lib/social/engagement";

/**
 * The player's best saved score in this game, next to the live score. It follows
 * the live score upward once the player passes it, and renders nothing for a
 * guest, a first run, or when the best can't be loaded.
 */
export function BestScore({ slug, score }: { slug: string; score: number }) {
  const best = useMyBestScore(slug);
  if (best === null) return null;
  return (
    <dd className="ml-2 text-xs text-muted-foreground tabular">
      {t("Best")} {points(Math.max(best, score))}
    </dd>
  );
}
