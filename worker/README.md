# LOQUIRA Auth Worker

Cloudflare Worker that securely bridges **www.lokiara.com** Firebase login to **LOQUIRA Desktop**.

## Production API (fixed URL)

```
https://api.lokiara.com/auth/desktop
```

Fallback (active until custom domain route is attached):

```
https://loquira-auth.alkaptin2030.workers.dev/auth/desktop
```

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/start` | Desktop creates pending session |
| POST | `/complete` | Website submits Firebase ID token |
| GET | `/status?state=` | Desktop polls session status |
| POST | `/consume` | Desktop receives one-time custom token |
| GET | `/health` | Health check |

## Deploy

```bash
cd worker
npm install
npm run deploy
```

Health check:

```bash
curl https://loquira-auth.alkaptin2030.workers.dev/auth/desktop/health
```

## Attach `api.lokiara.com` (required for fixed domain)

`lokiara.com` is currently on **Vercel DNS** (`ns1.vercel-dns.com`). Cloudflare cannot attach a Worker route until the zone is on the same Cloudflare account (`alkaptin2030@gmail.com`).

1. In [Cloudflare Dashboard](https://dash.cloudflare.com) → **Add a site** → `lokiara.com`
2. Copy the two Cloudflare nameservers Cloudflare gives you
3. At your domain registrar, replace Vercel nameservers with Cloudflare nameservers
4. In Cloudflare DNS, recreate records:
   - `www` → CNAME → your GitHub Pages host (keep website working)
   - `api` → will be handled by the Worker route (remove old A records to GitHub)
5. Uncomment in `wrangler.toml`:
   ```toml
   routes = [{ pattern = "api.lokiara.com/*", zone_name = "lokiara.com" }]
   ```
6. Redeploy:
   ```bash
   npm run deploy
   ```
7. Verify:
   ```bash
   curl https://api.lokiara.com/auth/desktop/health
   ```

## Firebase secrets (required for desktop auto-login)

```bash
npx wrangler secret put FIREBASE_CLIENT_EMAIL
npx wrangler secret put FIREBASE_PRIVATE_KEY
```

Use the Firebase service account for project `aiprogekt-155e1`.

## Security

- Firebase ID tokens verified via Identity Toolkit `accounts:lookup`
- Custom tokens created server-side only
- Sessions expire in 5 minutes (`SESSION_TTL_SECONDS`)
- Single-use via `/consume`
- No tokens in URLs
