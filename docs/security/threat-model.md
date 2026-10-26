# Threat model

The goal is production-grade security through defence in depth, not a claim that
the system is unhackable. Where a control is missing, it is listed under
[Gaps](#gaps) with the task that owns it.

## Assets, in order of value

1. **Accounts** — credentials, sessions, email addresses, and the ability to act
   as a user.
2. **Game integrity** — the score and leaderboard records. If a player can forge a
   score, the leaderboards lose their meaning.
3. **User content** — comments, likes, follows, uploads.
4. **Moderation state** — reports, hidden content, suspensions, roles.
5. **Operator data** — analytics, revenue (later), audit trails.
6. **Availability** of the feed, API and database.

## Actors

| Actor | Capability assumed |
| --- | --- |
| Anonymous visitor | Can call any public endpoint, read every public page, and send arbitrary bytes to any route. |
| Authenticated player | Holds a valid token for their own account; can replay and modify anything they can reach, including their own request bodies and any client-side state. |
| Malicious player | The above, with intent: enumeration, IDOR, score forgery, spam, privilege probing. |
| Compromised client | A modified app, an XSS in a third-party script, or a stolen token. |
| Moderator / admin | Trusted but not omnipotent; their actions are attributed and auditable. |
| Insider with key access | Holds `service_role` or database credentials. Out of scope for technical controls beyond least privilege and audit trails — an insider with the service key can read everything. |
| Automated abuse | Scrapers, credential stuffing, request floods, resource exhaustion. |

## Threats and the control that answers each

| # | Threat | Controls |
| --- | --- | --- |
| 1 | Broken access control / IDOR: reaching another user's row by changing an id | Ownership is derived from the verified token, never from the request; RLS on every exposed table; the RLS suite asserts the denied direction |
| 2 | Privilege escalation: making yourself an admin | Roles live in `user_roles` with **no** write grant for `authenticated`; `profiles` has no role column; role changes need `service_role`; a test asserts both the insert and the update are denied |
| 3 | Mass assignment: sending fields you must not set | `DisallowUnknownFields` on every decoded body; column-level grants; `reject_change` triggers on immutable columns such as `games.owner_id` |
| 4 | Score forgery | No `INSERT` grant on `scores` for clients; scores are written by the game-sessions service after validating a session it owns; the session holds the server-chosen seed and start time |
| 5 | SQL injection | Parameterised queries only; no dynamic SQL in services; the platform exposes no string-building query helper |
| 6 | XSS | React escapes by default; the only `dangerouslySetInnerHTML` is the chart component's generated `<style>`; JSON responses are `application/json` with `nosniff`; rendered documents enforce a nonce-based CSP (`script-src 'nonce-…' 'strict-dynamic'`, `src/lib/csp.ts`) in production, so injected inline scripts and event handlers do not run |
| 7 | CSRF | The API authenticates with a bearer token and `credentials: "omit"`, so a cross-site form post carries no authority; TanStack server functions are protected by `createCsrfMiddleware` |
| 8 | SSRF | The gateway forwards only to prefixes with a configured upstream whose URL must be `http(s)` with no query or fragment; an unconfigured group answers `503`; nothing user-supplied becomes a URL |
| 9 | Open redirect / proxy abuse | The gateway is a closed allowlist, not a forward proxy; `Host` is rewritten to the upstream, never taken from the client |
| 10 | Token forgery or replay | Signature verified against the project JWKS (ES256/RS256) or the HS256 secret; `alg: none` and unsupported algorithms rejected; `exp` and `iat` required; audience and issuer validated with 30s leeway; tokens over 8 KiB rejected; `service_role` tokens refused on user routes |
| 11 | Session theft | Tokens stay in the browser's storage and are sent only over HTTPS to the API; nothing logs a token; `BearerToken` reads only the `Authorization` header, never a cookie or query value |
| 12 | Brute-force authentication | Supabase Auth owns sign-in and enforces its own rate limits (`supabase/config.toml`); minimum password length 10; the API rate limit covers the auth group too |
| 13 | Request abuse / resource exhaustion | Token-bucket rate limit per IP (anonymous) and per verified user, `Retry-After` on `429`, probes exempted; 1 MiB body limit; 64 KiB header limit; server read/write/idle timeouts; `max_rows = 1000` on the Data API |
| 14 | Oversized or malformed payloads | `MaxBytesReader` before parsing; strict JSON decoding; unknown content types rejected; oversized bodies produce `413`, not a crash |
| 15 | Path traversal / malicious upload | Storage buckets have per-bucket size and MIME allowlists; object paths must start with the uploader's user id; objects are served as static bytes and never executed |
| 16 | Information leakage in errors | One error envelope; unknown errors become `500 internal` with a generic message; the real error is logged with the request id; auth failures never distinguish expired from forged |
| 17 | Missing security headers | Every API response: `nosniff`, `DENY`, `no-referrer`, CORP/COOP, Permissions-Policy, CSP `default-src 'none'`, HSTS in production, `no-store` — each exactly once (the gateway drops the upstream's copies). Documents: CSP, `nosniff`, `DENY`, HSTS. Static files (`vercel.json`): `nosniff` and a same-site `Access-Control-Allow-Origin` instead of the CDN's `*`. Fonts are self-hosted, so no third-party stylesheet loads without integrity |
| 18 | Insecure CORS | Exact origin allowlist; `*` rejected outside development; credentials never combined with a wildcard; unlisted origins receive no CORS headers |
| 19 | Secret exposure | Public/secret split documented and enforced by convention (`VITE_` prefix); `.env*` gitignored; `gitleaks` over the full history in CI; `service_role` never reaches the browser |
| 20 | Unauthorized database changes | Schema changes only through reviewed migrations; CI applies them to an empty database and runs the RLS suite; destructive migrations require an expand/migrate/contract sequence |
| 21 | Moderation abuse | Report resolution stamps the resolver from the token; moderation actions are append-only with the moderator recorded; hidden comments stay visible to their author (so moderation is not silent) and to staff |
| 22 | Data exfiltration by enumeration | Lists are cursor paginated with a capped `limit`; public profile reads expose only the granted columns; `is_suspended` is not readable through the Data API at all |
| 23 | CI as an attack path | Workflows declare `contents: read`, pin actions to a major tag or SHA, and a workflow-integrity job fails the build on an unpinned action or a write-all token; no workflow runs on a fork's secrets without review |

## Gaps

Honest list of what is **not** in place yet, and what should carry it:

1. **The document CSP allows inline styles and has no reporting.** Scripts are
   nonce-only, but `style-src` keeps `'unsafe-inline'` because SSR renders
   `style` attributes. No `report-to` endpoint collects violations, so a page
   the policy breaks is only noticed by a user. Add reporting once there is a
   place to send it.
2. **No service worker / offline handling.** A cached authenticated response
   could leak between sessions; the worker must be designed with that in mind.
3. **No upload scanning.** Buckets are limited by size and MIME, but content is
   not inspected. Before submissions are published publicly, add a scanning step.
4. **No audit log for admin reads.** Admin writes are recorded
   (`moderation_actions`); reads are not. Add an append-only access log when the
   admin service is implemented.
5. **No alerting.** There is no monitoring, no error budget and no
   anomaly detection on `429`/`401` rates.
6. **No account deletion flow.** `profiles` has no delete policy on purpose;
   deletion must be an explicit service operation with a documented retention
   policy (GDPR).
7. **Email deliverability and abuse.** Supabase Auth sends confirmation and reset
   mail; DMARC/SPF for a custom domain is not configured.
8. **No penetration test or bug bounty.** Neither has been done; nothing in this
   document should be read as a substitute.
9. **Rate limiting is in-process.** Correct for a single instance, insufficient
   once there are several — see
   [decisions/0004](../decisions/0004-rate-limiting.md).
10. **The hosted Supabase project was not inspected** (no credentials), so
    existing tables, policies and buckets in it are unknown. See the blockers in
    [development/environments.md](../development/environments.md).
