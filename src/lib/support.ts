import { msg } from "@/lib/settings/language";

/**
 * The questions players ask most, answered once: Settings → Help and the public
 * /support page show the same list.
 */
export const SUPPORT_FAQ: readonly (readonly [string, string])[] = [
  [
    msg("How do I create an account?"),
    msg(
      "Use Sign up with an email and password, open the confirmation link we email you, then log in. Google sign-in is available from the same screens once the provider is enabled.",
    ),
  ],
  [
    msg("How are scores verified?"),
    msg(
      "Play sessions are created by the server and scores are recorded against them. Only published games appear on leaderboards.",
    ),
  ],
  [
    msg("How do I follow someone?"),
    msg(
      "Open their profile or find them in Search and use Follow. Player-made games are coming later, and when they do, games from people you follow will show up in your Following feed.",
    ),
  ],
  [
    msg("How do I report a player?"),
    msg("Open their profile, tap the menu, and choose Report. Reports are reviewed by moderators."),
  ],
  [
    msg("How do I delete my account?"),
    msg(
      "Open Settings and tap Delete account at the bottom. Deletion is immediate and permanent: your profile, scores, comments, chats and everything else tied to your account are removed. unbored.lol/delete-account explains the same steps.",
    ),
  ],
];
