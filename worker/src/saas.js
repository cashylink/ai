/**
 * LOQUIRA Worker — read-only SaaS API backed by Firestore (server credentials).
 * Website calls with Firebase idToken; never exposes service account to clients.
 */

const FIRESTORE_BASE = 'https://firestore.googleapis.com/v1';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const LOOKUP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function fieldVal(fields, key) {
  const f = fields?.[key];
  if (!f) return undefined;
  if (f.stringValue !== undefined) return f.stringValue;
  if (f.integerValue !== undefined) return Number(f.integerValue);
  if (f.doubleValue !== undefined) return f.doubleValue;
  if (f.booleanValue !== undefined) return f.booleanValue;
  if (f.timestampValue !== undefined) return f.timestampValue;
  if (f.nullValue !== undefined) return null;
  if (f.mapValue?.fields) {
    const out = {};
    for (const [k, v] of Object.entries(f.mapValue.fields)) {
      out[k] = fieldVal({ [k]: v }, k);
    }
    return out;
  }
  return undefined;
}

function docToObj(doc) {
  if (!doc?.fields) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    out[k] = fieldVal(doc.fields, k);
  }
  return out;
}

async function getAccessToken(env) {
  const clientEmail = env.FIREBASE_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_PRIVATE_KEY;
  if (!clientEmail || !privateKey) return null;

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const input = `${header}.${payload}`;
  const key = await importPrivateKey(privateKey);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(input),
  );
  const jwt = `${input}.${base64urlBytes(new Uint8Array(sig))}`;

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  const data = await resp.json();
  return data.access_token || null;
}

async function getFirestoreDoc(env, collection, id, token) {
  const projectId = env.FIREBASE_PROJECT_ID || 'aiprogekt-155e1';
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${collection}/${encodeURIComponent(id)}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error('FS_GET_' + resp.status);
  const doc = await resp.json();
  return docToObj(doc);
}

async function listFirestoreCollection(env, collection, token, pageSize = 20) {
  const projectId = env.FIREBASE_PROJECT_ID || 'aiprogekt-155e1';
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${collection}?pageSize=${pageSize}`;
  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error('FS_LIST_' + resp.status);
  const data = await resp.json();
  return (data.documents || []).map((doc) => {
    const id = doc.name.split('/').pop();
    const fields = docToObj(doc) || {};
    return { id, data: { id, ...fields } };
  });
}

function objToFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'string') {
      if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
        fields[k] = { timestampValue: v };
      } else {
        fields[k] = { stringValue: v };
      }
    } else if (typeof v === 'number') {
      fields[k] = Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
    } else if (typeof v === 'boolean') {
      fields[k] = { booleanValue: v };
    }
  }
  return fields;
}

async function setFirestoreDoc(env, docPath, data, token) {
  const projectId = env.FIREBASE_PROJECT_ID || 'aiprogekt-155e1';
  const url = `${FIRESTORE_BASE}/projects/${projectId}/databases/(default)/documents/${docPath}`;
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: objToFirestoreFields(data) }),
  });
  if (!resp.ok) {
    const detail = await resp.text();
    throw new Error('FS_SET_' + resp.status + ':' + detail.slice(0, 200));
  }
  return resp.json();
}

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function verifyBearerToken(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;

  const apiKey = env.FIREBASE_API_KEY;
  if (!apiKey) return null;

  const resp = await fetch(`${LOOKUP_URL}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  const data = await resp.json();
  if (!resp.ok || !data.users?.length) return null;
  const u = data.users[0];
  return {
    uid: u.localId,
    email: u.email,
    displayName: u.displayName,
    photoURL: u.photoUrl,
  };
}

function monthKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_PLANS = {
  free: { id: 'free', name: 'Free', monthlyCredits: 500, priceEGP: 0 },
  starter: { id: 'starter', name: 'Starter', monthlyCredits: 3000, priceEGP: 149 },
  pro: { id: 'pro', name: 'Pro', monthlyCredits: 10000, priceEGP: 349 },
  business: { id: 'business', name: 'Business', monthlyCredits: 30000, priceEGP: 799 },
};

async function resolvePlan(env, planId, accessToken, body) {
  const plansRaw = await listFirestoreCollection(env, 'plans', accessToken, 20);
  const fromDb = plansRaw.map((p) => p.data).find((p) => p && p.id === planId);
  if (fromDb) return fromDb;
  const seed = DEFAULT_PLANS[planId];
  if (!seed) return null;
  return {
    ...seed,
    planName: body.planName || seed.name,
    monthlyCredits: Number(body.monthlyCredits) || seed.monthlyCredits,
    priceEGP: Number(body.priceEGP) || seed.priceEGP,
  };
}

/** Activate subscription + credit balance server-side (no payment gateway). */
async function activateUserPlan(env, uid, planId, accessToken, body = {}) {
  const plan = await resolvePlan(env, planId, accessToken, body);
  if (!plan) throw new Error('PLAN_NOT_FOUND');

  const now = Date.now();
  const periodEnd = now + 30 * DAY_MS;
  const monthlyCredits = Number(plan.monthlyCredits) || DEFAULT_PLANS[planId]?.monthlyCredits || 0;
  const planName = plan.name || body.planName || planId;

  let subscription = await getFirestoreDoc(env, 'subscriptions', uid, accessToken);
  const alreadyOnPlan = subscription?.planId === planId;

  if (!subscription) {
    subscription = {
      id: uid,
      userId: uid,
      planId,
      status: 'active',
      periodStart: now,
      renewalDate: periodEnd,
      autoRenew: true,
      paymentProvider: 'none',
      createdAt: now,
      updatedAt: now,
    };
  } else if (!alreadyOnPlan) {
    subscription = {
      ...subscription,
      planId,
      status: 'active',
      periodStart: now,
      renewalDate: periodEnd,
      autoRenew: true,
      paymentProvider: 'none',
      updatedAt: now,
    };
  }

  const creditBalance = {
    uid,
    planId,
    monthlyCredits,
    usedCredits: 0,
    reservedCredits: 0,
    remainingCredits: monthlyCredits,
    periodStart: now,
    periodEnd,
    updatedAt: now,
  };

  const writes = [
    setFirestoreDoc(env, `users/${uid}/planInterest/${planId}`, {
      userId: uid,
      planId,
      planName,
      priceEGP: plan.priceEGP ?? DEFAULT_PLANS[planId]?.priceEGP ?? 0,
      monthlyCredits,
      email: body.email || '',
      activatedAt: new Date(now).toISOString(),
      status: 'active',
    }, accessToken),
  ];

  if (!alreadyOnPlan) {
    writes.push(
      setFirestoreDoc(env, `subscriptions/${uid}`, subscription, accessToken),
      setFirestoreDoc(env, `creditBalances/${uid}`, creditBalance, accessToken),
    );
  }

  await Promise.all(writes);

  return {
    ok: true,
    changed: !alreadyOnPlan,
    planId,
    planName,
    status: 'active',
    subscription,
    creditBalance,
    allowance: {
      planId,
      planName,
      monthlyCredits,
      usedCredits: 0,
      remainingCredits: monthlyCredits,
      requests: 0,
    },
  };
}

export async function handleSaasRequest(request, env, path) {
  const user = await verifyBearerToken(request, env);
  if (!user?.uid) {
    return json({ error: 'UNAUTHENTICATED' }, 401);
  }

  const accessToken = await getAccessToken(env);
  if (!accessToken) {
    return json({ error: 'SAAS_BACKEND_NOT_CONFIGURED' }, 503);
  }

  try {
    if (path === '/api/saas/plan-interest' && request.method === 'POST') {
      const body = await readJsonBody(request);
      const planId = String(body.planId || '').trim().toLowerCase();
      const allowedPlans = new Set(['free', 'starter', 'pro', 'business']);
      if (!allowedPlans.has(planId)) {
        return json({ error: 'invalid_plan' }, 400);
      }

      const result = await activateUserPlan(env, user.uid, planId, accessToken, {
        ...body,
        email: user.email || '',
      });
      return json(result);
    }

    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    if (path === '/api/saas/plans') {
      const plans = await listFirestoreCollection(env, 'plans', accessToken, 20);
      const sorted = plans
        .map((p) => p.data)
        .filter((p) => p && p.active !== false)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      return json(sorted);
    }

    if (path === '/api/saas/me' || path === '/api/saas/usage') {
      const uid = user.uid;
      const [creditBalance, subscription, plansRaw, usageMonthly] = await Promise.all([
        getFirestoreDoc(env, 'creditBalances', uid, accessToken),
        getFirestoreDoc(env, 'subscriptions', uid, accessToken),
        listFirestoreCollection(env, 'plans', accessToken, 20),
        getFirestoreDoc(env, 'usageMonthly', `${uid}__${monthKey()}`, accessToken),
      ]);

      const plans = plansRaw
        .map((p) => p.data)
        .filter((p) => p && p.active !== false)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

      const planId = creditBalance?.planId || subscription?.planId || 'free';
      const plan = plans.find((p) => p.id === planId) || plans.find((p) => p.isDefault) || plans[0] || null;

      const monthlyCredits = creditBalance?.monthlyCredits ?? plan?.monthlyCredits ?? 0;
      const usedCredits = creditBalance?.usedCredits ?? usageMonthly?.creditsUsed ?? 0;
      const remainingCredits = creditBalance
        ? creditBalance.remainingCredits
        : Math.max(0, monthlyCredits - usedCredits);

      const allowance = {
        planId,
        planName: plan?.name || planId,
        monthlyCredits,
        usedCredits,
        remainingCredits,
        requests: usageMonthly?.requests ?? 0,
        month: monthKey(),
        periodStart: creditBalance?.periodStart ?? subscription?.periodStart ?? null,
        periodEnd: creditBalance?.periodEnd ?? subscription?.renewalDate ?? null,
        status: subscription?.status || 'active',
      };

      if (path === '/api/saas/usage') {
        return json({
          month: usageMonthly || { month: monthKey(), creditsUsed: usedCredits, requests: 0, byModel: {} },
          allowance,
          creditBalance,
          usageMonthly,
          monthKey: monthKey(),
        });
      }

      return json({
        profile: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        },
        subscription,
        plan,
        plans,
        allowance,
        creditBalance,
        usageMonthly,
        monthUsage: usageMonthly,
        storeMode: 'firestore',
        ts: Date.now(),
      });
    }

    return json({ error: 'not_found' }, 404);
  } catch (e) {
    console.error('[LOQUIRA SaaS]', e);
    return json({ error: 'SAAS_READ_FAILED' }, 500);
  }
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
