# Unbored documentation

This is the map. Every document below is written for a new contributor who has to
change something safely, not to describe the project to a stranger.

## Architecture — what exists and how it fits together

| Document                                                 | Read it when you need                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------- |
| [architecture/overview.md](architecture/overview.md)     | The system shape: web app, API, database, deployment, request path.    |
| [architecture/api.md](architecture/api.md)               | To add or change an API endpoint, or to understand the gateway.        |
| [architecture/data-model.md](architecture/data-model.md) | To change the schema, or to understand ownership and row access.       |
| [architecture/web-app.md](architecture/web-app.md)       | To work on the web app: SSR, SEO, PWA, performance, bundle.            |
| [games/README.md](games/README.md)                       | To work on a game's rules, or to make another catalogue game playable. |

## Development — how to work on it

| Document                                                   | Read it when you need                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| [development/local-setup.md](development/local-setup.md)   | To get a working checkout with a database and a running API. |
| [development/environments.md](development/environments.md) | To configure development, staging, preview or production.    |
| [development/conventions.md](development/conventions.md)   | Before opening a pull request.                               |
| [development/testing.md](development/testing.md)           | To run the tests that exist and to add new ones.             |

## Deployment — how it ships

| Document                                     | Read it when you need                                                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [deployment/vercel.md](deployment/vercel.md) | To deploy, to change the routing or the environment variables of the Vercel project, or to verify the API after a deploy. |

## Security — how it is defended

| Document                                                   | Read it when you need                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| [security/threat-model.md](security/threat-model.md)       | Assets, actors, threats and which control answers each one.   |
| [security/data-access.md](security/data-access.md)         | The authorization matrix: which role may touch which table.   |
| [security/api-hardening.md](security/api-hardening.md)     | The middleware chain and the baseline every service inherits. |
| [security/env-and-secrets.md](security/env-and-secrets.md) | To add a configuration value, or to handle an exposure.       |
| [security/testing.md](security/testing.md)                 | To see what is verified automatically, and what is not.       |

## Decisions — why it is this way

Short architecture decision records in [decisions/](decisions/README.md). Read the
one that covers an area before changing its design.

## Status

The foundation is complete — the UI, the API, the database and the deployment
path all exist — and the first features have landed on top of it: **Stack 10**,
**Chain**, **Memory Flash**, **One Move**, **Color Merge**, **Don't Touch the
Black** and **7 Second**, seven real games with server-issued sessions,
server-verified scores and working leaderboards. All seven catalogue games are
`playable`, each names the runtime that plays it, and 7 Second is the daily one:
same deck for everyone on a UTC day, one ranked attempt a day.

The remaining features (social, in-app notifications, search, moderation,
analytics, payments) each have a published contract and an unimplemented endpoint
that answers `501` until its own task lands. The game-release email digest is
implemented; see [development/analytics-and-email.md](development/analytics-and-email.md). See
[architecture/api.md](architecture/api.md) for the endpoint inventory.
