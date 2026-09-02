/**
 * Desktop app sign-in handoff (LOQUIRA ↔ www.lokiara.com).
 * login.html?client=desktop&state=...&agentPort=... — after Firebase auth, POST tokens to local agent server.
 * Tokens travel in POST body only (never in URL query for tokens).
 */

const DESKTOP_DEEP_LINK = 'forge-ai://forge-ai.forge-ai/auth-callback';
const DEFAULT_AGENT_PORTS = [37845, 38473];
const PING_TIMEOUT_MS = 600;

let handoffCompleted = false;
let handoffInFlight = null;

export function getDesktopAuthParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('client') !== 'desktop') return null;
  const state = (params.get('state') || '').trim();
  if (!state) return null;
  const agentPortRaw = parseInt(params.get('agentPort') || '', 10);
  const agentPort = Number.isFinite(agentPortRaw) ? agentPortRaw : null;
  return { state, agentPort };
}

export function isDesktopAuthFlow() {
  return getDesktopAuthParams() !== null;
}

function fetchWithTimeout(url, options = {}, timeoutMs = PING_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * Discover the local LOQUIRA agent server port for a pending desktop login state.
 * @param {string} state
 * @param {number | null} preferredPort
 */
async function resolveAgentHandoffPort(state, preferredPort) {
  const ports = [];
  if (preferredPort) ports.push(preferredPort);
  for (const p of DEFAULT_AGENT_PORTS) ports.push(p);
  for (let i = 0; i < 8; i++) ports.push(37845 + i);

  const seen = new Set();
  for (const port of ports) {
    if (seen.has(port)) continue;
    seen.add(port);
    try {
      const r = await fetchWithTimeout(
        `http://127.0.0.1:${port}/api/auth/desktop-handoff/ping?state=${encodeURIComponent(state)}`,
        { method: 'GET', mode: 'cors' },
      );
      if (r.ok) {
        const j = await r.json();
        if (j.ok && j.port) return j.port;
      }
    } catch (_) { /* agent not on this port */ }
  }
  return preferredPort || DEFAULT_AGENT_PORTS[0];
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
    const refreshToken = user.refreshToken || '';
    const profile = {
      uid: user.uid,
      displayName: user.displayName || '',
      email: user.email || '',
      photoURL: user.photoURL || '',
    };

    const agentPort = await resolveAgentHandoffPort(params.state, params.agentPort);
    const handoffUrl = `http://127.0.0.1:${agentPort}/api/auth/desktop-handoff`;
    let resp;
    try {
      resp = await fetchWithTimeout(handoffUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          state: params.state,
          idToken,
          refreshToken: refreshToken || undefined,
          profile,
        }),
      }, 8000);
    } catch (_) {
      throw new Error('LOQUIRA_NOT_REACHABLE');
    }

    if (!resp.ok) {
      let detail = 'HANDOFF_FAILED';
      try {
        const err = await resp.json();
        detail = err.error || detail;
      } catch (_) { /* ignore */ }
      if (detail === 'invalid_state') {
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
