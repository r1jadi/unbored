// Substantive terms and privacy text based on the implemented service.
//
// The operator is Rijad Halili, an individual; contact contactunbored@gmail.com;
// governing law: the Republic of Kosovo. Effective date: 2026-11-12. This is
// product-accurate copy, not legal advice: have counsel review it.

import { msg, t } from "@/lib/settings/language";

/** Who runs Unbored and how to reach them: the one place these details live. */
export const OPERATOR = {
  name: "Rijad Halili",
  email: "contactunbored@gmail.com",
  country: "Republic of Kosovo",
} as const;

export const terms = [
  [
    msg("1. What Unbored is"),
    msg(
      "Unbored is a web catalogue of short playable games with accounts, profiles, scores, leaderboards, follows, comments, direct messages, notifications and moderation. Browsing the catalogue is public; scoring, following, commenting, messaging, notifications and settings require an account.",
    ),
  ],
  [
    msg("2. Accounts, verification and security"),
    msg(
      "You must be at least 13 years old to create an account. Sign up with an email and password or with Google OAuth; email addresses are verified through a confirmation link before sign-in. You are responsible for activity on your account and for keeping your credentials secure. We may rate-limit credential attempts and require reauthentication for sensitive actions.",
    ),
  ],
  [
    msg("3. Fair play and leaderboards"),
    msg(
      "Scores must be earned by playing in the app. Play sessions are created server-side and scores are recorded against them; only published games appear on leaderboards. Automated play, exploiting bugs, manipulating sessions or leaderboard abuse may lead to score removal, content removal or account restriction.",
    ),
  ],
  [
    msg("4. Your content and social features"),
    msg(
      "Display names, bios, follows, blocked-user choices and notification preferences you set remain yours. You grant Unbored a licence to display profile and social content within the service so follows, leaderboards and notifications can function. Private-account, leaderboard-visibility and interaction settings in Settings → Privacy control who can see your activity where implemented.",
    ),
  ],
  [
    msg("5. Prohibited conduct"),
    msg(
      "No harassment, hate speech, spam, impersonation, cheating, abuse of reporting or blocking, or interference with the service. Content and accounts that break these rules may be hidden, restricted or suspended by moderators and administrators.",
    ),
  ],
  [
    msg("6. Moderation and enforcement"),
    msg(
      "You can report a player, a comment or a game from where you see it, and block a player at any time. Moderators review reports and the review queue; administrators manage games, categories, users, announcements and system settings. Enforcement ranges from hidden content to suspension. Decisions are made from database records of the reported content and account history. A report made from a chat shares the reported player's last 5 messages in that chat with moderators, and direct messages are otherwise not read by staff.",
    ),
  ],
  [
    msg("7. Deletion and data handling"),
    msg(
      "You can delete your account at any time from the bottom of Settings (Delete account), or as described at unbored.lol/delete-account. Deletion is immediate and permanent and cannot be undone: it removes your profile and picture, scores and leaderboard entries, comments, likes, saved games, follows, blocks, chats you were part of, notifications and saved runs. Moderators with actions on record are removed by the operator on request, so the moderation log stays accountable. See the Privacy Policy for what is collected and how long it is kept.",
    ),
  ],
  [
    msg("8. Availability, changes and third parties"),
    msg(
      "The service is provided as-is and may change, including games, scores display, social features and rate limits. Authentication and hosting run on Supabase and Vercel; Google sign-in and linking, when enabled, are subject to Google's terms. No uptime guarantee is made. Support questions go to contactunbored@gmail.com or unbored.lol/support.",
    ),
  ],
  [
    msg("9. Intellectual property"),
    msg(
      "Games, artwork, branding and the app itself remain the property of their respective owners. You may not copy, redistribute or misrepresent them.",
    ),
  ],
  [
    msg("10. Changes to these terms"),
    msg(
      "Material changes are announced in the app before they take effect. Continued use after the effective date constitutes acceptance.",
    ),
  ],
  [
    msg("11. Contact and operator details"),
    msg(
      "Unbored is operated by Rijad Halili, an individual based in the Republic of Kosovo. For questions about your account, these terms or your data, email contactunbored@gmail.com or visit unbored.lol/support. These terms are governed by the laws of the Republic of Kosovo, and disputes go to its competent courts. Nothing in these terms removes protections that the consumer law of the country you live in gives you and that cannot be waived.",
    ),
  ],
];

export const privacy = [
  [
    msg("What we collect"),
    msg(
      "Account and authentication: email, password verifier (stored by Supabase Auth, never by Unbored), email-verification state, OAuth provider identities you link (Google), and session tokens stored in this browser only (see Storage, cookies and local data below). Profile: username (generated), display name, bio, avatar object path, onboarding state. Gameplay: play sessions (game, seed, start/end times) and scores (session, game, value, duration). Social, when you use it: follows, blocked-user relationships, comments, likes, saves, direct messages, challenges, notification rows (kind, payload, read time) and your privacy/notification preferences. Reports you file and feedback you send. Security, when you use it: two-step verification factors (held by Supabase Auth), and for each signed-in device the session's browser details, IP address and last-active time, which you can see in Settings → Security. Push, when you turn it on: this browser's push subscription (an address at your browser's push service and its encryption keys) and language. Analytics, only if you accept them: page views, in-app events, and session recordings with form inputs masked, tied to your account id and role but never your email. Operational: rate-limit counters, request ids and error logs needed to run and protect the API.",
    ),
  ],
  [
    msg("What we do not collect"),
    msg(
      "No payment data (no payments feature exists), no advertising trackers, and no device fingerprint inventory beyond what the browser necessarily sends. Nothing is sold. Analytics do not start, and set no cookies, until you accept them.",
    ),
  ],
  [
    msg("How we use it"),
    msg(
      "To create and secure accounts, verify email, run play sessions and leaderboards, work out achievements and trending games from verified scores, render profiles and follow graphs, carry direct messages, deliver notifications for genuine events (such as new followers) in the app and by push on devices you turned it on for, send announcements from the Unbored team, send the new-games email digest if you opted in, enforce blocks and privacy choices, moderate reported content, understand how the app is used if you accepted analytics, and keep the platform safe within rate limits.",
    ),
  ],
  [
    msg("Who can see it"),
    msg(
      "Profiles (username, display name, bio, avatar), published games, scores on visible games, follows and visible comments are public by default. Private-account and visibility toggles in Settings → Privacy limit discovery where implemented. Achievements follow the same choice as your scores. Direct messages are visible only to the two players in the chat, except that a report made from a chat shares the reported player's last 5 messages in it with moderators; reports do not reveal who filed them to the person reported. Notifications and preferences are visible only to their owner; roles are visible only to their owner and to staff. Administrators and moderators see moderation queues and audit trails through the staff-gated admin API.",
    ),
  ],
  [
    msg("Storage, cookies and local data"),
    msg(
      "Your session tokens (access and refresh) are saved in this browser's localStorage under one namespaced Unbored key so a reload keeps you signed in; the app re-checks them with the server on load and removes them on sign-out or when the server refuses the session. Appearance and accessibility choices persist in this browser's localStorage, and your language choice in a cookie, so the server can show pages in it. Recent searches, sound and vibration choices and your cookie choice persist in this browser's localStorage. If you accept analytics, PostHog and Vercel Analytics set their own cookies or local identifiers; you can withdraw in Settings → Privacy. To let games run offline, a service worker keeps the app's code, pages and the public game catalogue in this browser, and offline practice runs stay on this device. OAuth PKCE verifiers live in sessionStorage for the duration of one sign-in attempt. Avatar images live in the public `avatars` Supabase Storage bucket under your account folder.",
    ),
  ],
  [
    msg("Infrastructure"),
    msg(
      "Hosting and API: Vercel (web app, Go gateway and Go services on one domain). Identity, database and storage: Supabase (Auth, Postgres with Row Level Security, Storage). OAuth, when enabled: Google. Email (the new-games digest and feedback mail): Resend. Product analytics, only with your consent: PostHog and Vercel Analytics. Push messages pass through your browser's own push service (for example Google, Apple, Mozilla or Microsoft), encrypted so that service can't read them. No other processors are used by this deployment.",
    ),
  ],
  [
    msg("Retention and deletion"),
    msg(
      "Data is kept while your account is active. You can delete your account at any time from the bottom of Settings (Delete account), or as described at unbored.lol/delete-account. Deletion is immediate and permanent: it removes your profile and picture, preferences, scores and leaderboard entries, comments, likes, saves, follows, blocks, every chat you were part of, reports you filed, push subscriptions, signed-in devices and notifications. Two things outlive it: encrypted database backups held by Supabase, which expire on its schedule within 30 days, and analytics events (only if you accepted analytics), which stay in PostHog under an account id that no longer belongs to anyone; email us to have those erased too.",
    ),
  ],
  [
    msg("Your choices and rights"),
    msg(
      "Edit profile, privacy, notification, language, appearance, accessibility, cookie and blocked-user settings in Settings; each control persists and takes effect as described on its screen. Turn push on or off per device, opt in or out of the email digest and announcements, sign out other devices and turn on two-step verification in Settings. To request a copy of your data, a correction or deletion, email contactunbored@gmail.com from the address on your account. We answer within one month.",
    ),
  ],
  [
    msg("Contact"),
    msg(
      "Unbored is operated by Rijad Halili, an individual based in the Republic of Kosovo, who is responsible for your data. Privacy contact: contactunbored@gmail.com. You can also complain to the data protection authority where you live.",
    ),
  ],
];

export function LegalBody({ sections }: { sections: string[][] }) {
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <p className="text-xs text-muted-foreground">{t("Last updated November 12, 2026")}</p>
      {sections.map(([h, b]) => (
        <section key={h}>
          <h2 className="font-semibold">{t(h)}</h2>
          <p className="mt-1 text-muted-foreground">{t(b)}</p>
        </section>
      ))}
    </div>
  );
}
