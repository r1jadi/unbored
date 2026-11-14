# Deployment

| Document                                   | Read it when you need                                                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| [production.md](production.md)             | To deploy, change environment variables, roll back, or verify `https://api.unbored.lol/healthz` and the site.             |
| [archive/vercel.md](archive/vercel.md)     | History only: the Vercel Services deployment that ran until 2026-11-13, and why the Go services have Vercel-named entrypoints. |

The current hosting is decided in
[decisions/0016](../decisions/0016-cloudflare-and-render-hosting.md): website on
Cloudflare Workers, API on Render (Frankfurt), crons on GitHub Actions. It
supersedes the Vercel topology of [0009](../decisions/0009-vercel-deployment-topology.md),
[0010](../decisions/0010-auth-service-deployment-topology.md) and
[0015](../decisions/0015-direct-service-routing.md).
