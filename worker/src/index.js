/**
 * LOQUIRA — Cloudflare Worker: secure website → desktop Firebase auth handoff.
 * Endpoints (base /api/auth/desktop):
 *   POST /start    — desktop creates pending session
 *   POST /complete — website submits verified Firebase idToken
 *   GET  /status   — desktop polls session status
 *   POST /consume  — desktop receives one-time custom token
 */

const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';
const SESSION_PREFIX = 'desktop:';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = normalizePath(url.pathname);

    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, request);
    }

    try {
      if (path === '/api/auth/desktop/start' && request.method === 'POST') {
        return corsResponse(await handleStart(request, env), 200, request);
      }
      if (path === '/api/auth/desktop/complete' && request.method === 'POST') {
        return corsResponse(await handleComplete(request, env), 200, request);
      }
      if (path === '/api/auth/desktop/status' && request.method === 'GET') {
        return corsResponse(await handleStatus(url, env), 200, request);
      }
      if (path === '/api/auth/desktop/consume' && request.method === 'POST') {
        return corsResponse(await handleConsume(request, env), 200, request);
      }
      if (path === '/api/auth/desktop/health' && request.method === 'GET') {
        return corsResponse(json({ ok: true, service: 'loquira-desktop-auth', version: 1 }), 200, request);
      }
      return corsResponse(json({ error: 'not_found' }), 404, request);
    } catch (err) {
      console.error('[LOQUIRA Worker]', err);
      return corsResponse(json({ error: 'internal_error' }), 500, request);
    }
  },
};

function normalizePath(pathname) {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p.startsWith('/auth/desktop/')) {
    return '/api/auth/desktop' + p.slice('/auth/desktop'.length);
  }
  return p;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function corsResponse(response, status, request) {
  const origin = request.headers.get('Origin') || '';
  const allowed = isAllowedOrigin(origin);
  const headers = new Headers(response?.headers || {});
  headers.set('Content-Type', 'application/json');
  headers.set('Access-Control-Allow-Origin', allowed ? origin : 'https://www.lokiara.com');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Access-Control-Max-Age', '86400');
  const body = response?.body ?? null;
  return new Response(body, { status: response?.status ?? status, headers });
}

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.hostname === 'www.lokiara.com' || u.hostname === 'lokiara.com' || u.hostname === 'localhost';
  } catch {
    return false;
  }
}

function sessionTtlSec(env) {
  const n = parseInt(env.SESSION_TTL_SECONDS || '300', 10);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

function randomState() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function getSession(env, state) {
  if (!state) return null;
  const raw = await env.DESKTOP_AUTH.get(SESSION_PREFIX + state);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function putSession(env, state, session) {
  const ttl = Math.max(60, Math.floor((session.expiresAt - Date.now()) / 1000));
  await env.DESKTOP_AUTH.put(SESSION_PREFIX + state, JSON.stringify(session), { expirationTtl: ttl });
}

function isExpired(session) {
  return !session || Date.now() > session.expiresAt;
}

async function handleStart(request, env) {
  const body = await readJson(request);
  let state = String(body.state || '').trim();
  if (!state || state.length < 16 || state.length > 128) {
    state = randomState();
  }

  const now = Date.now();
  const ttl = sessionTtlSec(env) * 1000;
  const session = {
    state,
    client: 'desktop',
    status: 'pending',
    consumed: false,
    createdAt: now,
    expiresAt: now + ttl,
  };
  await putSession(env, state, session);

  const loginBase = env.LOQUIRA_WEB_LOGIN_URL || 'https://www.lokiara.com/login.html';
  const sep = loginBase.includes('?') ? '&' : '?';
  const loginUrl = `${loginBase}${sep}client=desktop&state=${encodeURIComponent(state)}`;

  return json({ ok: true, state, expiresAt: session.expiresAt, loginUrl });
}

async function handleComplete(request, env) {
  const body = await readJson(request);
  const state = String(body.state || '').trim();
  const idToken = String(body.idToken || '').trim();
  if (!state || !idToken) {
    return json({ error: 'state_and_idToken_required' }, 400);
  }

  const session = await getSession(env, state);
  if (!session) {
    return json({ error: 'invalid_state' }, 410);
  }
  if (isExpired(session)) {
    return json({ error: 'expired' }, 410);
  }
  if (session.consumed) {
    return json({ error: 'already_consumed' }, 409);
  }
  if (session.status === 'completed') {
    return json({ ok: true, status: 'completed' });
  }

  const verified = await verifyFirebaseIdToken(idToken, env);
  if (!verified?.uid) {
    return json({ error: 'invalid_token' }, 401);
  }

  let customToken = null;
  if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    try {
      customToken = await createFirebaseCustomToken(verified.uid, env.FIREBASE_CLIENT_EMAIL, env.FIREBASE_PRIVATE_KEY);
    } catch (e) {
      console.error('[LOQUIRA Worker] custom token failed:', e);
    }
  }

  session.status = 'completed';
  session.uid = verified.uid;
  session.email = verified.email || '';
  session.displayName = verified.displayName || '';
  session.photoURL = verified.photoURL || '';
  session.customToken = customToken || undefined;
  session.completedAt = Date.now();
  await putSession(env, state, session);

  return json({ ok: true, status: 'completed' });
}

async function handleStatus(url, env) {
  const state = String(url.searchParams.get('state') || '').trim();
  if (!state) {
    return json({ error: 'state_required' }, 400);
  }

  const session = await getSession(env, state);
  if (!session || isExpired(session)) {
    return json({ status: 'expired' });
  }
  if (session.consumed) {
    return json({ status: 'already_consumed' });
  }
  if (session.status === 'completed') {
    return json({ status: 'completed' });
  }
  return json({ status: 'pending' });
}

async function handleConsume(request, env) {
  const body = await readJson(request);
  const state = String(body.state || '').trim();
  if (!state) {
    return json({ error: 'state_required' }, 400);
  }

  const session = await getSession(env, state);
  if (!session) {
    return json({ error: 'invalid_state' }, 410);
  }
  if (isExpired(session)) {
    return json({ error: 'expired' }, 410);
  }
  if (session.consumed) {
    return json({ error: 'already_consumed' }, 409);
  }
  if (session.status !== 'completed' || !session.uid) {
    return json({ error: 'not_ready', status: session.status || 'pending' }, 409);
  }

  session.consumed = true;
  session.consumedAt = Date.now();
  await putSession(env, state, session);

  const out = {
    ok: true,
    uid: session.uid,
    email: session.email || undefined,
    displayName: session.displayName || undefined,
    photoURL: session.photoURL || undefined,
  };
  if (session.customToken) {
    out.customToken = session.customToken;
  }
  return json(out);
}

async function verifyFirebaseIdToken(idToken, env) {
  const apiKey = env.FIREBASE_API_KEY;
  const projectId = env.FIREBASE_PROJECT_ID || 'aiprogekt-155e1';
  if (!apiKey) return null;

  const payload = decodeJwtPayload(idToken);
  if (!payload) return null;
  const exp = Number(payload.exp || 0) * 1000;
  if (exp && exp < Date.now()) return null;
  const aud = String(payload.aud || '');
  if (aud && aud !== projectId) return null;

  const resp = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.users?.length) return null;
  const u = data.users[0];
  return {
    uid: u.localId || String(payload.user_id || payload.sub || ''),
    email: u.email || payload.email,
    displayName: u.displayName || payload.name,
    photoURL: u.photoUrl || payload.picture,
  };
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    return JSON.parse(atob(b64 + pad));
  } catch {
    return null;
  }
}

async function createFirebaseCustomToken(uid, clientEmail, privateKeyPem) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    sub: clientEmail,
    aud: 'https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit',
    iat: now,
    exp: now + 3600,
    uid,
  };
  const enc = new TextEncoder();
  const head = base64url(JSON.stringify(header));
  const body = base64url(JSON.stringify(claims));
  const input = `${head}.${body}`;
  const key = await importPrivateKey(privateKeyPem);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(input));
  return `${input}.${base64urlBytes(new Uint8Array(sig))}`;
}

function base64url(str) {
  return base64urlBytes(new TextEncoder().encode(str));
}

function base64urlBytes(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importPrivateKey(pem) {
  const normalized = pem.replace(/\\n/g, '\n');
  const b64 = normalized
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    raw.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}
