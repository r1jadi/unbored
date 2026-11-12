# Architecture decision records

One file per decision, numbered, immutable once accepted. When a decision changes,
add a new record that supersedes the old one and mark the old one superseded — do
not edit history.

| #                                                | Decision                                                                                             | Status                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| [0001](0001-go-module-strategy.md)               | One platform library and one services module in a Go workspace                                       | Accepted                   |
| [0002](0002-web-app-location.md)                 | The web app stays at the repository root, with a documented path to `apps/web`                       | Accepted                   |
| [0003](0003-authentication-and-identity.md)      | Supabase Auth as the identity provider; tokens verified independently by every service               | Accepted                   |
| [0004](0004-rate-limiting.md)                    | In-process token buckets now, Redis when the API scales out                                          | Accepted                   |
| [0005](0005-payments.md)                         | RaiAccept for payments, behind a service boundary that does not exist yet                            | Accepted                   |
| [0006](0006-dependency-and-lockfile-policy.md)   | `bun.lock` is authoritative; no dependency is added without updating it                              | Accepted                   |
| [0007](0007-database-authorization-model.md)     | Grants plus RLS, with privileges in a separate table                                                 | Accepted                   |
| [0008](0008-browser-data-access.md)              | The browser talks to `/api/v1` for domain data; Supabase directly only for auth and storage          | Accepted (amended by 0014) |
| [0009](0009-vercel-deployment-topology.md)       | The Go gateway deploys as a service of the existing Vercel project, on the platform's port           | Accepted (amended by 0010, 0015) |
| [0010](0010-auth-service-deployment-topology.md) | The auth service deploys as a private Vercel service, reached by a binding from a container gateway  | Superseded by 0015         |
| [0011](0011-users-service-and-real-profile.md)   | The users service serves the real profile, deployed privately beside auth                            | Accepted (amended by 0015) |
| [0012](0012-server-verified-scores.md)           | Scores are verified by the database, and the session service holds no master key                     | Accepted                   |
| [0013](0013-admin-authorization.md)              | Admin authorization is a database row checked on every request, and roles are granted by an operator | Accepted                   |
| [0014](0014-realtime-direct-messages.md)         | Direct messages use the Data API and Realtime directly, and Realtime carries no text                 | Accepted                   |
| [0015](0015-direct-service-routing.md)           | Vercel routes each API group straight to its service; the gateway container is retired               | Accepted                   |

## Template

```markdown
# NNNN — Title

- Status: proposed | accepted | superseded by NNNN
- Date: YYYY-MM-DD
- Deciders: who agreed

## Context

What forces the decision, including the constraints that are not negotiable.

## Decision

What was decided, in the present tense, precisely enough to implement.

## Consequences

What becomes easier, what becomes harder, and what has to be true for this to work.
Include the cost of reversing it.
```
