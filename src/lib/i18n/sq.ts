/**
 * Albanian (`sq`): every English source string the app passes to `t()` or marks
 * with `msg()`, keyed by the English text, and the catalogue text
 * `translateContent` looks up. See `src/lib/settings/language.tsx`.
 *
 * Split by area so each part stays reviewable. Where two parts translate the
 * same English word, the later one wins: player-facing screens come last.
 */
import { sqAdmin } from "@/lib/i18n/sq-admin";
import { sqApp } from "@/lib/i18n/sq-app";
import { sqContent } from "@/lib/i18n/sq-content";
import { sqFeatures } from "@/lib/i18n/sq-features";
import { sqGames } from "@/lib/i18n/sq-games";
import { sqHints } from "@/lib/i18n/sq-hints";
import { sqRules } from "@/lib/i18n/sq-rules";

export const sq: Record<string, string> = {
  ...sqAdmin,
  ...sqContent,
  ...sqApp,
  ...sqFeatures,
  ...sqRules,
  ...sqHints,
  ...sqGames,
};
