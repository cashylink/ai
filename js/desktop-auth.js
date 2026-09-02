/**
 * Desktop app sign-in handoff via Cloudflare Worker (LOQUIRA ↔ www.lokiara.com).
 * login.html?client=desktop&state=... — after Firebase auth, POST idToken to Worker over HTTPS.
 * Tokens never appear in URL query strings.
 */

import { getAuthApiBase } from './loquira-auth-api.js';

const DESKTOP_DEEP_LINK = 'forge-ai://forge-ai.forge-ai/auth/complete';
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
    const apiBases = [
      getAuthApiBase(),
      'https://loquira-auth.alkaptin2030.workers.dev/auth/desktop',
    ];
    let lastError = null;
    for (const apiBase of apiBases) {
      try {
        const resp = await fetchWithTimeout(`${apiBase}/complete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: params.state, idToken }),
        });
        if (!resp.ok) {
          let detail = 'HANDOFF_FAILED';
          try {
            const err = await resp.json();
            detail = err.error || detail;
          } catch (_) { /* ignore */ }
          if (detail === 'invalid_state' || detail === 'expired') {
            throw new Error('SESSION_EXPIRED');
          }
          lastError = new Error(detail);
          continue;
        }
        handoffCompleted = true;
        const successUrl = `desktop-auth-success.html?state=${encodeURIComponent(params.state)}`;
        window.location.replace(successUrl);
        return true;
      } catch (e) {
        lastError = e;
      }
    }
    if (lastError?.message === 'SESSION_EXPIRED') throw lastError;
    throw lastError || new Error('WORKER_NOT_REACHABLE');
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
