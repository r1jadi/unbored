// Substantive terms and privacy text based on the implemented service.
// No registered company, address, jurisdiction or contact identity is invented
// here: where operator details are required, the document says exactly what the
// owner must supply (see OPERATOR_DETAILS_REQUIRED below).
//
// Effective date: 2026-10-17. Review with counsel before public launch; this
// is product-accurate copy, not legal advice.

export const OPERATOR_DETAILS_REQUIRED = [
  "Legal operator name (person or company) and contact email for account, terms and privacy requests.",
  "Jurisdiction / governing law and support response expectations, if any are promised.",
  "Data-retention periods beyond the implemented 30-day deletion target, if the policy must state them.",
] as const;

export const terms = [
  [
    "1. What Unbored is",
    "Unbored is a web catalogue of short playable games with accounts, profiles, scores, leaderboards, follows, notifications and moderation. Browsing the catalogue is public; scoring, following, notifications and settings require an account.",
  ],
  [
    "2. Accounts, verification and security",
    "You must be at least 13 years old to create an account. Sign up with an email and password or with Google OAuth; email addresses are verified through a confirmation link before sign-in. You are responsible for activity on your account and for keeping your credentials secure. We may rate-limit credential attempts and require reauthentication for sensitive actions.",
  ],
  [
    "3. Fair play and leaderboards",
    "Scores must be earned by playing in the app. Play sessions are created server-side and scores are recorded against them; only published games appear on leaderboards. Automated play, exploiting bugs, manipulating sessions or leaderboard abuse may lead to score removal, content removal or account restriction.",
  ],
  [
    "4. Your content and social features",
    "Display names, bios, follows, blocked-user choices and notification preferences you set remain yours. You grant Unbored a licence to display profile and social content within the service so follows, leaderboards and notifications can function. Private-account, leaderboard-visibility and interaction settings in Settings → Privacy control who can see your activity where implemented.",
  ],
  [
    "5. Prohibited conduct",
    "No harassment, hate speech, spam, impersonation, cheating, abuse of reporting or blocking, or interference with the service. Content and accounts that break these rules may be hidden, restricted or suspended by moderators and administrators.",
  ],
  [
    "6. Moderation and enforcement",
    "Moderators review reports and the review queue; administrators manage games, categories, users and system settings. Enforcement ranges from hidden content to suspension. Decisions are made from database records of the reported content and account history.",
  ],
  [
    "7. Deletion and data handling",
    "You can delete your account at any time from Settings. Deletion is immediate and permanent: it removes your profile and picture, scores and leaderboard entries, comments, likes, saved games, follows, blocks, notifications and saved runs. Moderators with actions on record are removed by an administrator, so the moderation log stays accountable. See the Privacy Policy for what is collected and how long it is kept.",
  ],
  [
    "8. Availability, changes and third parties",
    "The service is provided as-is and may change, including games, scores display, social features and rate limits. Authentication and hosting run on Supabase and Vercel; Google sign-in, when enabled, is subject to Google's terms. No uptime, response-time or support promise is made in this document.",
  ],
  [
    "9. Intellectual property",
    "Games, artwork, branding and the app itself remain the property of their respective owners. You may not copy, redistribute or misrepresent them. Creator-published games are subject to the publishing review described in the app.",
  ],
  [
    "10. Changes to these terms",
    "Material changes are announced in the app before they take effect. Continued use after the effective date constitutes acceptance.",
  ],
  [
    "11. Contact and operator details",
    "Operator identity and contact: TO BE SUPPLIED BY THE OWNER before public launch (see the note at the top of this document). Until then, use the project issue tracker linked in Settings → Help.",
  ],
];

export const privacy = [
  [
    "What we collect",
    "Account and authentication: email, password verifier (stored by Supabase Auth, never by Unbored), email-verification state, OAuth provider identities you link (Google), and session tokens stored in this browser only (see Storage, cookies and local data below). Profile: username (generated), display name, bio, avatar object path, onboarding state. Gameplay: play sessions (game, seed, start/end times) and scores (session, game, value, duration). Social, when you use it: follows, blocked-user relationships, notification rows (kind, payload, read time) and your privacy/notification preferences. Operational: rate-limit counters, request ids and error logs needed to run and protect the API.",
  ],
  [
    "What we do not collect",
    "No payment data (no payments feature exists), no push subscriptions (no push delivery exists), no email campaign data (no email delivery beyond Supabase auth mails), no device fingerprint inventory beyond what the browser necessarily sends, and no analytics events beyond the append-only table the backend validates — the app does not run third-party analytics or advertising trackers.",
  ],
  [
    "How we use it",
    "To create and secure accounts, verify email, run play sessions and leaderboards, render profiles and follow graphs, deliver in-app notifications for genuine events (such as new followers), enforce blocks and privacy choices, moderate reported content, and keep the platform safe within rate limits.",
  ],
  [
    "Who can see it",
    "Profiles (username, display name, bio, avatar), published games, scores on visible games, follows and visible comments are public by default. Private-account and visibility toggles in Settings → Privacy limit discovery where implemented. Notifications and preferences are visible only to their owner; roles are visible only to their owner and to staff. Administrators and moderators see moderation queues and audit trails through the staff-gated admin API.",
  ],
  [
    "Storage, cookies and local data",
    "Your session tokens (access and refresh) are saved in this browser's localStorage under one namespaced Unbored key so a reload keeps you signed in; the app re-checks them with the server on load and removes them on sign-out or when the server refuses the session. Appearance, language and accessibility choices persist in this browser's localStorage. Recent searches persist in this browser's localStorage. OAuth PKCE verifiers live in sessionStorage for the duration of one sign-in attempt. Avatar images live in the public `avatars` Supabase Storage bucket under your account folder.",
  ],
  [
    "Infrastructure",
    "Hosting and API: Vercel (web app, Go gateway and Go services on one domain). Identity, database and storage: Supabase (Auth, Postgres with Row Level Security, Storage). OAuth, when enabled: Google. No other processors are used by this deployment.",
  ],
  [
    "Retention and deletion",
    "Data is kept while your account is active. You can delete your account from Settings at any time; deletion immediately removes your profile and picture, preferences, scores, comments, likes, saves, follows, blocks and notifications. Backups, if any, age out on the provider's schedule.",
  ],
  [
    "Your choices and rights",
    "Edit profile, privacy, notification, language, appearance, accessibility and blocked-user settings in Settings; each supported control persists and takes effect as described on its screen. Unsupported controls (push, email delivery, MFA, per-device session lists) are labelled unavailable rather than simulated. To request access, correction or deletion, open an issue on the project tracker from your signed-in account until a dedicated privacy contact is published.",
  ],
  [
    "Contact",
    "Privacy contact: TO BE SUPPLIED BY THE OWNER before public launch (operator name and email). Until then, use the project issue tracker linked in Settings → Help. This policy is product-accurate documentation, not legal advice; have counsel review it before public launch.",
  ],
];

export function LegalBody({ sections }: { sections: string[][] }) {
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <p className="text-xs text-muted-foreground">Last updated October 17, 2026</p>
      {sections.map(([h, b]) => (
        <section key={h}>
          <h2 className="font-semibold">{h}</h2>
          <p className="mt-1 text-muted-foreground">{b}</p>
        </section>
      ))}
    </div>
  );
}
