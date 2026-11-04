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

import { t } from "@/lib/settings/language";
export type UserPreferences = {
  privateAccount: boolean;
  /** Visitors see best scores on the profile. Independent of `privateAccount`. */
  showProfileScores: boolean;
  showOnLeaderboards: boolean;
  showRecentlyPlayed: boolean;
  allowComments: boolean;
  allowMentions: boolean;
  personalisedRecommendations: boolean;
  notifyBeats: boolean;
  notifyFollowers: boolean;
  notifyComments: boolean;
  notifyNewGames: boolean;
  /** In the app, for each new game. `notifyNewGames` is the email digest. */
  notifyGameReleases: boolean;
  notifyMessages: boolean;
  /** Who can start a chat. Someone this player has already written to can always reply. */
  allowMessagesFrom: MessagePrivacy;
  /** "Seen" in chats. It goes both ways: off, this player neither shows nor sees it. */
  showReadReceipts: boolean;
  language: string | null;
  appearance: string | null;
};

export type MessagePrivacy = "everyone" | "friends" | "nobody";

export const defaultPreferences: UserPreferences = {
  privateAccount: false,
  showProfileScores: true,
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
  notifyGameReleases: true,
  notifyMessages: true,
  allowMessagesFrom: "friends",
  showReadReceipts: true,
  language: null,
  appearance: null,
};

type Row = {
  user_id: string;
  private_account: boolean;
  show_profile_scores: boolean;
  show_on_leaderboards: boolean;
  show_recently_played: boolean;
  allow_comments: boolean;
  allow_mentions: boolean;
  personalised_recommendations: boolean;
  notify_beats: boolean;
  notify_followers: boolean;
  notify_comments: boolean;
  notify_new_games: boolean;
  notify_game_releases: boolean;
  notify_messages: boolean;
  allow_messages_from: MessagePrivacy;
  show_read_receipts: boolean;
  language: string | null;
  appearance: string | null;
};

function toPreferences(row: Row): UserPreferences {
  return {
    privateAccount: row.private_account,
    showProfileScores: row.show_profile_scores,
    showOnLeaderboards: row.show_on_leaderboards,
    showRecentlyPlayed: row.show_recently_played,
    allowComments: row.allow_comments,
    allowMentions: row.allow_mentions,
    personalisedRecommendations: row.personalised_recommendations,
    notifyBeats: row.notify_beats,
    notifyFollowers: row.notify_followers,
    notifyComments: row.notify_comments,
    notifyNewGames: row.notify_new_games,
    notifyGameReleases: row.notify_game_releases,
    notifyMessages: row.notify_messages,
    allowMessagesFrom: row.allow_messages_from,
    showReadReceipts: row.show_read_receipts,
    language: row.language,
    appearance: row.appearance,
  };
}

function toRow(prefs: UserPreferences, userId: string): Row {
  return {
    user_id: userId,
    private_account: prefs.privateAccount,
    show_profile_scores: prefs.showProfileScores,
    show_on_leaderboards: prefs.showOnLeaderboards,
    show_recently_played: prefs.showRecentlyPlayed,
    allow_comments: prefs.allowComments,
    allow_mentions: prefs.allowMentions,
    personalised_recommendations: prefs.personalisedRecommendations,
    notify_beats: prefs.notifyBeats,
    notify_followers: prefs.notifyFollowers,
    notify_comments: prefs.notifyComments,
    notify_new_games: prefs.notifyNewGames,
    notify_game_releases: prefs.notifyGameReleases,
    notify_messages: prefs.notifyMessages,
    allow_messages_from: prefs.allowMessagesFrom,
    show_read_receipts: prefs.showReadReceipts,
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
    throw new Error(t("Sign in to change preferences."));
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
