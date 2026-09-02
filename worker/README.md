# LOQUIRA Auth Worker

Cloudflare Worker that securely bridges **www.lokiara.com** Firebase login to **LOQUIRA Desktop**.

## Endpoints

Base: `https://www.lokiara.com/api/auth/desktop`

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/start` | Desktop creates pending session |
| POST | `/complete` | Website submits Firebase ID token |
| GET | `/status?state=` | Desktop polls session status |
| POST | `/consume` | Desktop receives one-time custom token |
| GET | `/health` | Health check |

## Setup

1. Create KV namespace:
   ```bash
   cd worker
   npm install
   npx wrangler kv namespace create DESKTOP_AUTH
   npx wrangler kv namespace create DESKTOP_AUTH --preview
   ```
2. Paste KV ids into `wrangler.toml`.
3. Set Firebase service account secrets (for custom tokens):
   ```bash
   npx wrangler secret put FIREBASE_CLIENT_EMAIL
   npx wrangler secret put FIREBASE_PRIVATE_KEY
   ```
4. Deploy:
   ```bash
   npm run deploy
   ```
5. In Cloudflare dashboard, add a route:
   - `www.lokiara.com/api/auth/desktop/*` → `loquira-auth` worker

## Security

- Firebase ID tokens verified via Identity Toolkit `accounts:lookup`
- Custom tokens created server-side only
- Sessions expire in 5 minutes (configurable via `SESSION_TTL_SECONDS`)
- Single-use via `/consume` + `consumed` flag
- No tokens in URLs

## Local dev

```bash
npm run dev
```

Set `LOQUIRA_AUTH_API_BASE` in website/desktop to your `*.workers.dev` URL while testing.
