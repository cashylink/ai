/**
 * Desktop app sign-in handoff (LOQUIRA ↔ loquira.ai).
 * When login.html is opened with ?client=desktop&state=...&agentPort=...,
 * after Firebase auth completes we POST tokens to the local agent server.
 */

const DESKTOP_DEEP_LINK = 'forge-ai://forge-ai.forge-ai/auth-callback';

let handoffCompleted = false;

export function getDesktopAuthParams() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('client') !== 'desktop') return null;
  const state = (params.get('state') || '').trim();
  if (!state) return null;
  const agentPort = parseInt(params.get('agentPort') || '37845', 10);
  return {
    state,
    agentPort: Number.isFinite(agentPort) ? agentPort : 37845,
  };
}

export function isDesktopAuthFlow() {
  return getDesktopAuthParams() !== null;
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

  const handoffUrl = `http://127.0.0.1:${params.agentPort}/api/auth/desktop-handoff`;
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

export function openDesktopApp(state) {
  const q = state ? `?state=${encodeURIComponent(state)}` : '';
  window.location.href = `${DESKTOP_DEEP_LINK}${q}`;
}
