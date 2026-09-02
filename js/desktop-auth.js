/**
 * Desktop app sign-in handoff via Cloudflare Worker (LOQUIRA ↔ www.lokiara.com).
 * login.html?client=desktop&state=... — after Firebase auth, POST idToken to Worker over HTTPS.
 * Tokens never appear in URL query strings.
 */

import { LOQUIRA_AUTH_ENDPOINTS } from './loquira-auth-api.js';

const DESKTOP_DEEP_LINK = 'forge-ai://forge-ai.forge-ai/auth-callback';
const HANDOFF_TIMEOUT_MS = 12000;

let handoffCompleted = false;
let handoffInFlight = null;

export function getDesktopAuthParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('client') !== 'desktop') return null;
  const state = (params.get('state') || '').trim();
  if (!state) return null;
  return { state };
}

export function isDesktopAuthFlow() {
  return getDesktopAuthParams() !== null;
}

function fetchWithTimeout(url, options = {}, timeoutMs = HANDOFF_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * @param {import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js').User} user
 */
export async function completeDesktopHandoff(user) {
  const params = getDesktopAuthParams();
  if (!params) return false;
  if (handoffCompleted) return true;
  if (handoffInFlight) return handoffInFlight;

  handoffInFlight = (async () => {
    const idToken = await user.getIdToken(true);
    let resp;
    try {
      resp = await fetchWithTimeout(LOQUIRA_AUTH_ENDPOINTS.complete, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: params.state,
          idToken,
        }),
      });
    } catch (_) {
      throw new Error('WORKER_NOT_REACHABLE');
    }

    if (!resp.ok) {
      let detail = 'HANDOFF_FAILED';
      try {
        const err = await resp.json();
        detail = err.error || detail;
      } catch (_) { /* ignore */ }
      if (detail === 'invalid_state' || detail === 'expired') {
        throw new Error('SESSION_EXPIRED');
      }
      throw new Error(detail);
    }

    handoffCompleted = true;
    const successUrl = `desktop-auth-success.html?state=${encodeURIComponent(params.state)}`;
    window.location.replace(successUrl);
    return true;
  })();

  try {
    return await handoffInFlight;
  } finally {
    handoffInFlight = null;
  }
}

/** Open LOQUIRA via custom protocol — state only, no tokens. */
export function openDesktopApp(state) {
  const q = state ? `?state=${encodeURIComponent(state)}` : '';
  window.location.href = `${DESKTOP_DEEP_LINK}${q}`;
}
