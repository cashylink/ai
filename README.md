# LOQUIRA

Marketing site and post-login dashboard for **LOQUIRA** — The AI Development Workspace.

## Deploy (static hosting)

Upload the repository root to any static host (GitHub Pages, Netlify, Vercel, cPanel, etc.).

**Required files:**
- `index.html`, `login.html`, `signup.html`, `workspace.html`
- `css/` — styles
- `js/` — Firebase auth, dashboard, landing page

No build step required.

## Firebase setup

1. **Authentication** → Enable Email/Password and Google
2. **Authorized domains** → Add your production domain (and `localhost` for local dev)
3. **Firestore** → Enable and deploy `firestore.rules` for dashboard projects

Project: `aiprogekt-155e1`

## Local preview

```bash
python -m http.server 8888
```

Open `http://localhost:8888`
