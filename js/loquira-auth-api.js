/**
 * LOQUIRA hosted auth API (Cloudflare Worker).
 * Website + Desktop use HTTPS only — no localhost handoff.
 */

export const LOQUIRA_AUTH_API_BASE = 'https://www.lokiara.com/api/auth/desktop';

export const LOQUIRA_AUTH_ENDPOINTS = Object.freeze({
  start: `${LOQUIRA_AUTH_API_BASE}/start`,
  complete: `${LOQUIRA_AUTH_API_BASE}/complete`,
  status: `${LOQUIRA_AUTH_API_BASE}/status`,
  consume: `${LOQUIRA_AUTH_API_BASE}/consume`,
  health: `${LOQUIRA_AUTH_API_BASE}/health`,
});

export const LOQUIRA_WEB_LOGIN_URL = 'https://www.lokiara.com/login.html';

export function buildDesktopLoginUrl(state) {
  return `${LOQUIRA_WEB_LOGIN_URL}?client=desktop&state=${encodeURIComponent(state)}`;
}
