# Hosted Supabase settings

`supabase/config.toml` configures the local stack only. The hosted project keeps
its own copy of these settings in the dashboard, and nothing in this repository
can read or change them. Check each one after creating a project, and again
after any change to the Auth settings.

Do not run `supabase config push` against production to sync them: it pushes the
whole file, including the localhost `site_url`.

| Setting | Where (Dashboard → …) | Required value |
| --- | --- | --- |
| Leaked-password protection | Authentication → Sign In / Providers → Email → *Prevent use of leaked passwords* | On (needs the Pro plan; it checks new passwords against Have I Been Pwned) |
| Minimum password length | Same page → *Minimum password length* | 10, matching `config.toml` |
| Refresh-token rotation | Authentication → Sessions (older dashboards: Auth → Settings) → *Detect and revoke potentially compromised refresh tokens* | On |
| Refresh-token reuse interval | Same page | 10 seconds |
| MFA (TOTP) | Authentication → Multi-Factor → *Authenticator app (TOTP)* | Enabled |
| Max enrolled factors | Same page | 10 |
| Email confirmations | Authentication → Sign In / Providers → Email → *Confirm email* | On |
| Anonymous sign-ins | Authentication → Sign In / Providers | Off |
| Auth rate limits | Authentication → Rate Limits | At least as strict as `[auth.rate_limit]` in `config.toml` |

If a setting is not where this table says, the dashboard has moved it. Search the
Authentication section for the setting's name.
