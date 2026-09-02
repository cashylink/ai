/**
 * Desktop app sign-in handoff (LOQUIRA ↔ www.lokiara.com).
 * login.html?client=desktop&state=... — after Firebase auth, POST tokens to local agent server.
 * Tokens travel in POST body only (never in URL or localStorage).
 */

const DESKTOP_DEEP_LINK = 'forge-ai://forge-ai.forge-ai/auth-callback';
const DEFAULT_AGENT_PORTS = [37845, 38473];

let handoffCompleted = false;

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

/**
 * Discover the local LOQUIRA agent server port for a pending desktop login state.
 * @param {string} state
 */
async function resolveAgentHandoffPort(state) {
  const ports = [...DEFAULT_AGENT_PORTS];
  for (let i = 0; i < 20; i++) {
    ports.push(37845 + i);
  }
  const seen = new Set();
  for (const port of ports) {
    if (seen.has(port)) continue;
    seen.add(port);
    try {
      const r = await fetch(
        `http://127.0.0.1:${port}/api/auth/desktop-handoff/ping?state=${encodeURIComponent(state)}`,
        { method: 'GET', mode: 'cors' },
      );
      if (r.ok) {
        const j = await r.json();
        if (j.ok && j.port) return j.port;
      }
    } catch (_) { /* agent not on this port */ }
  }
  return DEFAULT_AGENT_PORTS[0];
}

/**
 * @param {import('https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js').User} user
 */
export async function completeDesktopHandoff(user) {
  const params = getDesktopAuthParams();
  if (!params) return false;
  if (handoffCompleted) return true;

  const idToken = await user.getIdToken(true);
  const refreshToken = user.refreshToken || '';
  const profile = {
    uid: user.uid,
    displayName: user.displayName || '',
    email: user.email || '',
    photoURL: user.photoURL || '',
  };

  const agentPort = await resolveAgentHandoffPort(params.state);
  const handoffUrl = `http://127.0.0.1:${agentPort}/api/auth/desktop-handoff`;
  const resp = await fetch(handoffUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: params.state,
      idToken,
      refreshToken: refreshToken || undefined,
      profile,
    }),
  });

  if (!resp.ok) {
    let detail = 'HANDOFF_FAILED';
    try {
      const err = await resp.json();
      detail = err.error || detail;
    } catch (_) { /* ignore */ }
    throw new Error(detail);
  }

  handoffCompleted = true;
  const successUrl = `desktop-auth-success.html?state=${encodeURIComponent(params.state)}`;
  window.location.replace(successUrl);
  return true;
}

/** Open LOQUIRA via custom protocol — state only, no tokens. */
export function openDesktopApp(state) {
  const q = state ? `?state=${encodeURIComponent(state)}` : '';
  window.location.href = `${DESKTOP_DEEP_LINK}${q}`;
}
