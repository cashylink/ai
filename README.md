# LOQUIRA

Marketing site and post-login dashboard for **LOQUIRA** — The AI Development Workspace.

## Deploy (static hosting)

Upload the repository root to any static host (GitHub Pages, Netlify, Vercel, cPanel, etc.).

**Required files:**
- `index.html`, `login.html`, `signup.html`, `workspace.html`
- `css/` — styles
- `js/` — Firebase auth, dashboard, landing page

No build step required for local dev. For a clean deploy bundle:

```bash
npm run dist
```

This creates a `dist/` folder with only the files needed for hosting.

## Firebase setup

1. **Authentication** → Enable Email/Password and Google
2. **Authorized domains** → Add your production domain (and `localhost` for local dev)
3. **Firestore** → Enable and deploy `firestore.rules` for dashboard projects

Project: `aiprogekt-155e1`

### Firestore data (dashboard)

| Path | Purpose |
|------|---------|
| `users/{uid}/projects` | User projects |
| `users/{uid}/settings/loquira-sync` | Model catalog sync metadata |
| `users/{uid}/loquiraModels/{modelId}` | LOQUIRA app models (customer-facing metadata only) |

Models sync automatically on dashboard load. Provider/API configuration is managed internally by LOQUIRA — not exposed in the customer dashboard.

## Local preview

```bash
python -m http.server 8888
```

Open `http://localhost:8888`
