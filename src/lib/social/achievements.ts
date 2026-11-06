/**
 * Achievements: thresholds over counters the database reads from verified scores
 * (`public.profile_achievements`). Nothing is awarded by the client and nothing is
 * stored, so a removed score takes its achievement with it and old runs count.
 */

import { useQuery } from "@tanstack/react-query";

import { getAccessToken } from "@/lib/auth/session";
import { msg } from "@/lib/settings/language";
import { getQueryClient } from "@/lib/query";
import { restGet } from "@/lib/supabase/rest";

export type AchievementCounters = {
  runs: number;
  games: number;
  days: number;
  longestStreak: number;
  firstPlaces: number;
  followers: number;
};

export type Achievement = {
  id: string;
  title: string;
  description: string;
  counter: keyof AchievementCounters;
  goal: number;
};

export const ACHIEVEMENTS: readonly Achievement[] = [
  {
    id: "first-run",
    title: msg("First run"),
    description: msg("Finish a scored run."),
    counter: "runs",
    goal: 1,
  },
  {
    id: "ten-runs",
    title: msg("Warming up"),
    description: msg("Finish 10 scored runs."),
    counter: "runs",
    goal: 10,
  },
  {
    id: "hundred-runs",
    title: msg("Regular"),
    description: msg("Finish 100 scored runs."),
    counter: "runs",
    goal: 100,
  },
  {
    id: "thousand-runs",
    title: msg("Unstoppable"),
    description: msg("Finish 1,000 scored runs."),
    counter: "runs",
    goal: 1000,
  },
  {
    id: "five-games",
    title: msg("Explorer"),
    description: msg("Score in 5 different games."),
    counter: "games",
    goal: 5,
  },
  {
    id: "fifteen-games",
    title: msg("Collector"),
    description: msg("Score in 15 different games."),
    counter: "games",
    goal: 15,
  },
  {
    id: "week-streak",
    title: msg("Full week"),
    description: msg("Score on 7 days in a row."),
    counter: "longestStreak",
    goal: 7,
  },
  {
    id: "month-streak",
    title: msg("Full month"),
    description: msg("Score on 30 days in a row."),
    counter: "longestStreak",
    goal: 30,
  },
  {
    id: "fifty-days",
    title: msg("Keeps coming back"),
    description: msg("Score on 50 different days."),
    counter: "days",
    goal: 50,
  },
  {
    id: "first-place",
    title: msg("Top of the board"),
    description: msg("Hold the top score in a game."),
    counter: "firstPlaces",
    goal: 1,
  },
  {
    id: "three-first-places",
    title: msg("Triple crown"),
    description: msg("Hold the top score in 3 games at once."),
    counter: "firstPlaces",
    goal: 3,
  },
  {
    id: "ten-followers",
    title: msg("Getting noticed"),
    description: msg("Reach 10 followers."),
    counter: "followers",
    goal: 10,
  },
];

export type AchievementRead = { visible: false } | { visible: true; counters: AchievementCounters };

type Row =
  | { visible: false }
  | {
      visible: true;
      runs: number;
      games: number;
      days: number;
      longest_streak: number;
      first_places: number;
      followers: number;
    };

export function useAchievements(userId: string | undefined) {
  return useQuery(
    {
      queryKey: ["profile-achievements", userId],
      enabled: Boolean(userId),
      queryFn: async (): Promise<AchievementRead> => {
        const row = await restGet<Row>(
          `rpc/profile_achievements?p_user_id=${encodeURIComponent(userId ?? "")}`,
          getAccessToken(),
        );
        if (!row.visible) return { visible: false };
        return {
          visible: true,
          counters: {
            runs: Number(row.runs),
            games: Number(row.games),
            days: Number(row.days),
            longestStreak: Number(row.longest_streak),
            firstPlaces: Number(row.first_places),
            followers: Number(row.followers),
          },
        };
      },
      staleTime: 60_000,
      retry: false,
    },
    getQueryClient(),
  );
}
