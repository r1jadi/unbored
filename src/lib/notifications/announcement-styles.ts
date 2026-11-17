import {
  CalendarDays,
  ExternalLink,
  Eye,
  Megaphone,
  Palette,
  Play,
  RefreshCw,
  Sparkles,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import { msg } from "@/lib/settings/language";

/**
 * The parts an administrator picks so an announcement looks like the notifications
 * Unbored sends by itself. The database and the admin service accept exactly these.
 */
export const ANNOUNCEMENT_STYLES = {
  news: { label: msg("News"), icon: Megaphone },
  new_game: { label: msg("New game"), icon: Sparkles },
  feature: { label: msg("New feature"), icon: Wand2 },
  event: { label: msg("Event"), icon: CalendarDays },
  theme: { label: msg("New theme"), icon: Palette },
  update: { label: msg("Update"), icon: RefreshCw },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

export type AnnouncementStyle = keyof typeof ANNOUNCEMENT_STYLES;

export const ANNOUNCEMENT_ACTIONS = {
  open: { label: msg("Open"), icon: ExternalLink },
  play: { label: msg("Play"), icon: Play },
  try: { label: msg("Try it"), icon: Wand2 },
  look: { label: msg("Take a look"), icon: Eye },
} as const satisfies Record<string, { label: string; icon: LucideIcon }>;

export type AnnouncementAction = keyof typeof ANNOUNCEMENT_ACTIONS;

export function isAnnouncementStyle(value: unknown): value is AnnouncementStyle {
  return typeof value === "string" && Object.hasOwn(ANNOUNCEMENT_STYLES, value);
}

export function isAnnouncementAction(value: unknown): value is AnnouncementAction {
  return typeof value === "string" && Object.hasOwn(ANNOUNCEMENT_ACTIONS, value);
}
