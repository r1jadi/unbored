# Free hosting: Cloudflare (website) + Render (API)

A $0 alternative to Vercel. Same code; only where it runs changes.

| Piece | Host | Free limits |
|---|---|---|
| Website (TanStack Start SSR + static assets) | Cloudflare Workers | 100k dynamic requests/day; static files unlimited |
| API (auth + users + games in one process, `services/cmd/standalone`) | Render free web service | 750 h/month (enough for one always-on service); sleeps after 15 min idle |
| Daily crons | GitHub Actions (`.github/workflows/cron.yml`) | free |
| Domain DNS | Cloudflare (free) | — |

## 1. API on Render
1. render.com → sign up with GitHub → **New → Blueprint** → pick this repo. It reads `render.yaml`.
2. Fill the secret values it asks for: `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `OPENAI_API_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `ADMIN_EMAILS`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`.
3. Wait for the deploy, then open `https://api.unbored.lol/healthz` → `ok`.
4. Keep it awake: a free monitor (UptimeRobot or cron-job.org) hitting `/healthz` every 10 minutes. One service always on is ~720 h, inside the 750 h.

## 2. Website on Cloudflare Workers
1. dash.cloudflare.com → **Workers & Pages → Create → Import a repository** → this repo.
2. Build command: `bun install && bun run build` · Deploy command: `npx wrangler deploy`.
3. Build variables (all public, plain text):
   - `NITRO_PRESET` = `cloudflare_module`
   - `VITE_API_BASE_URL` = `https://api.unbored.lol/api/v1`
   - `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_PUBLIC_SITE_URL` (`https://unbored.lol`), `VITE_PUBLIC_POSTHOG_KEY`, `VITE_PUBLIC_POSTHOG_HOST`, `VITE_VAPID_PUBLIC_KEY`
4. Deploy and test the `*.workers.dev` address.

`VITE_*` values are baked in at build time: change one → redeploy.

## 3. Domain
1. Cloudflare → **Add a domain** → `unbored.lol` (Free plan). It copies the existing DNS records — check the Resend/email ones (MX, TXT, CNAME) are there.
2. Cloudflare shows two nameservers. At the registrar (Vercel → Domains → unbored.lol → Nameservers → Edit) replace Vercel's with Cloudflare's. Takes minutes to a few hours.
3. Worker → **Settings → Domains & Routes → Add custom domain** → `unbored.lol` and `www.unbored.lol`.
4. API: DNS → add `CNAME api → unbored-api-eu.onrender.com`, **DNS only** (grey cloud). Render issues the certificate for `api.unbored.lol`.
5. SSL/TLS → Edge Certificates → **Always Use HTTPS** on; Rules → Redirect Rules → `https://www.unbored.lol/*` → `https://unbored.lol/${1}` (301, keep query string).

## 4. Crons
GitHub repo → Settings → Secrets and variables → Actions → add `API_ORIGIN` (`https://api.unbored.lol`) and `CRON_SECRET`. Test with Actions → cron → Run workflow.
