/**
 * LOQUIRA hosted auth API (Cloudflare Worker).
 * Production: https://api.lokiara.com/auth/desktop
 * Fallback (active until api DNS route is attached): workers.dev
 */
export const LOQUIRA_AUTH_API_BASE = 'https://api.lokiara.com/auth/desktop';

/** workers.dev endpoint — used when custom domain route is not yet attached */
export const LOQUIRA_AUTH_API_FALLBACK = 'https://loquira-auth.alkaptin2030.workers.dev/auth/desktop';

export function getAuthApiBase() {
  return LOQUIRA_AUTH_API_BASE;
}

export const LOQUIRA_AUTH_ENDPOINTS = Object.freeze({
  start: `${LOQUIRA_AUTH_API_BASE}/start`,
  complete: `${LOQUIRA_AUTH_API_BASE}/complete`,
  status: `${LOQUIRA_AUTH_API_BASE}/status`,
  consume: `${LOQUIRA_AUTH_API_BASE}/consume`,
  health: `${LOQUIRA_AUTH_API_BASE}/health`,
});

export const LOQUIRA_WEB_LOGIN_URL = 'https://www.lokiara.com/login.html';

/** Read-only billing API (Worker → Firestore). */
export const LOQUIRA_SAAS_API_BASE = 'https://api.lokiara.com/api/saas';

export function buildDesktopLoginUrl(state) {
  return `${LOQUIRA_WEB_LOGIN_URL}?client=desktop&state=${encodeURIComponent(state)}`;
}
