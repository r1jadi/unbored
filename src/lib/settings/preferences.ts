/**
 * Persistent user preferences backed by `public.user_preferences`.
 *
 * Privacy toggles, notification toggles and the language/appearance choices
 * are stored per user (RLS: own row only). Guests get local fallbacks only;
 * nothing is written for another user and server-side checks enforce the
 * same ownership. A missing row is defaults, never an error.
 */

import { getAccessToken, getAuthState } from "@/lib/auth/session";
import { restGet, restMutate } from "@/lib/supabase/rest";

export type UserPreferences = {
  privateAccount: boolean;
  showOnLeaderboards: boolean;
  showRecentlyPlayed: boolean;
  allowComments: boolean;
  allowMentions: boolean;
  personalisedRecommendations: boolean;
  notifyBeats: boolean;
  notifyFollowers: boolean;
  notifyComments: boolean;
  notifyNewGames: boolean;
  language: string | null;
  appearance: string | null;
};

export const defaultPreferences: UserPreferences = {
  privateAccount: false,
  showOnLeaderboards: true,
  showRecentlyPlayed: true,
  allowComments: true,
  allowMentions: true,
  personalisedRecommendations: true,
  notifyBeats: true,
  notifyFollowers: true,
  notifyComments: true,
  // Email is opt-in: the sign-up form and Settings both collect explicit consent.
  notifyNewGames: false,
  language: null,
  appearance: null,
};

type Row = {
  user_id: string;
  private_account: boolean;
  show_on_leaderboards: boolean;
  show_recently_played: boolean;
  allow_comments: boolean;
  allow_mentions: boolean;
  personalised_recommendations: boolean;
  notify_beats: boolean;
  notify_followers: boolean;
  notify_comments: boolean;
  notify_new_games: boolean;
  language: string | null;
  appearance: string | null;
};

function toPreferences(row: Row): UserPreferences {
  return {
    privateAccount: row.private_account,
    showOnLeaderboards: row.show_on_leaderboards,
    showRecentlyPlayed: row.show_recently_played,
    allowComments: row.allow_comments,
    allowMentions: row.allow_mentions,
    personalisedRecommendations: row.personalised_recommendations,
    notifyBeats: row.notify_beats,
    notifyFollowers: row.notify_followers,
    notifyComments: row.notify_comments,
    notifyNewGames: row.notify_new_games,
    language: row.language,
    appearance: row.appearance,
  };
}

function toRow(prefs: UserPreferences, userId: string): Row {
  return {
    user_id: userId,
    private_account: prefs.privateAccount,
    show_on_leaderboards: prefs.showOnLeaderboards,
    show_recently_played: prefs.showRecentlyPlayed,
    allow_comments: prefs.allowComments,
    allow_mentions: prefs.allowMentions,
    personalised_recommendations: prefs.personalisedRecommendations,
    notify_beats: prefs.notifyBeats,
    notify_followers: prefs.notifyFollowers,
    notify_comments: prefs.notifyComments,
    notify_new_games: prefs.notifyNewGames,
    language: prefs.language,
    appearance: prefs.appearance,
  };
}

export async function loadPreferences(): Promise<UserPreferences> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") return defaultPreferences;
  try {
    const rows = await restGet<Row[]>(
      `user_preferences?user_id=eq.${auth.session.userId}&select=*`,
      token,
    );
    if (rows.length === 0) return defaultPreferences;
    return toPreferences(rows[0]!);
  } catch {
    return defaultPreferences;
  }
}

export async function savePreferences(prefs: UserPreferences): Promise<UserPreferences> {
  const token = getAccessToken();
  const auth = getAuthState();
  if (!token || auth.status !== "authenticated") {
    throw new Error("Sign in to change preferences.");
  }
  const row = toRow(prefs, auth.session.userId);
  // Upsert on the primary key: one row per user, owned by that user.
  await restMutate(
    "user_preferences?on_conflict=user_id",
    "POST",
    token,
    row,
    "resolution=merge-duplicates",
  );
  return prefs;
}
