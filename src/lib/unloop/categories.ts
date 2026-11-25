/**
 * Unloop's channels. The list matches the database CHECK and the admin API, so a
 * video can only ever carry one of these.
 *
 * Each channel has a hue of its own. It is only an identity colour — the ring
 * around a playing loop, the glow behind it, the chip that picks it — never a
 * signal: coral stays the one colour for actions, as everywhere else in Unbored.
 */

import { Brain, Clapperboard, Lightbulb, PartyPopper, Sparkles, Timer } from "lucide-react";

import { msg } from "@/lib/settings/language";

export const UNLOOP_CATEGORIES = [
  { slug: "highlights", label: msg("Highlights"), hue: 40, icon: Sparkles },
  { slug: "how-to", label: msg("How-to"), hue: 235, icon: Lightbulb },
  { slug: "speedruns", label: msg("Speedruns"), hue: 155, icon: Timer },
  { slug: "brain-food", label: msg("Brain food"), hue: 300, icon: Brain },
  { slug: "behind-the-scenes", label: msg("Behind the scenes"), hue: 85, icon: Clapperboard },
  { slug: "just-for-fun", label: msg("Just for fun"), hue: 350, icon: PartyPopper },
] as const;

export type UnloopCategory = (typeof UNLOOP_CATEGORIES)[number]["slug"];

export function isUnloopCategory(value: unknown): value is UnloopCategory {
  return UNLOOP_CATEGORIES.some((category) => category.slug === value);
}

export function unloopCategory(slug: string) {
  return UNLOOP_CATEGORIES.find((category) => category.slug === slug) ?? UNLOOP_CATEGORIES[0];
}

/** The channel's identity colour, as a CSS colour at a given lightness and alpha. */
export function unloopHue(slug: string, lightness = 0.72, alpha = 1): string {
  return `oklch(${lightness} 0.16 ${unloopCategory(slug).hue} / ${alpha})`;
}
