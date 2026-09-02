/**
 * LOQUIRA — website SaaS API client (Cloudflare Worker proxy → Firestore).
 * Uses Firebase idToken; never writes credits from the browser.
 */
import { auth } from './firebase-config.js';

export const LOQUIRA_SAAS_API_BASE = 'https://api.lokiara.com/api/saas';

export async function getIdTokenForSaas(forceRefresh = false) {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken(forceRefresh);
}

async function saasFetch(path, idToken, options = {}) {
  const method = options.method || 'GET';
  const resp = await fetch(`${LOQUIRA_SAAS_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!resp.ok) {
    const err = new Error(`SAAS_HTTP_${resp.status}`);
    err.status = resp.status;
    try {
      err.body = await resp.json();
    } catch {
      /* ignore */
    }
    throw err;
  }
  return resp.json();
}

export async function fetchSaasMe(idToken) {
  return saasFetch('/me', idToken);
}

export async function fetchSaasUsage(idToken) {
  return saasFetch('/usage', idToken);
}

export async function fetchSaasPlans(idToken) {
  return saasFetch('/plans', idToken);
}

export async function postSaasPlanInterest(idToken, plan) {
  return saasFetch('/plan-interest', idToken, {
    method: 'POST',
    body: {
      planId: plan.id,
      planName: plan.name,
      priceEGP: plan.priceEGP ?? 0,
      monthlyCredits: plan.monthlyCredits ?? 0,
    },
  });
}

/** Map Worker /me payload into dashboard account snapshot shape. */
export function mapSaasMeToSnapshot(me, recentUsage, creditProducts) {
  const allowance = me.allowance || {};
  const plan = me.plan || null;
  const plans = Array.isArray(me.plans) ? me.plans : (plan ? [plan] : []);

  return {
    plans,
    plan,
    subscription: me.subscription || null,
    creditBalance: me.creditBalance || null,
    usageMonthly: me.usageMonthly || me.monthUsage || null,
    recentUsage: recentUsage || [],
    creditProducts: creditProducts || [],
    summary: {
      planId: allowance.planId || plan?.id || 'free',
      planName: allowance.planName || plan?.name || 'Free',
      priceEGP: plan?.priceEGP ?? 0,
      monthlyCredits: allowance.monthlyCredits ?? plan?.monthlyCredits ?? 0,
      usedCredits: allowance.usedCredits ?? 0,
      remainingCredits: allowance.remainingCredits ?? 0,
      requests: allowance.requests ?? 0,
      estimatedCostUSD: null,
      percentRemaining: (allowance.monthlyCredits ?? 0) > 0
        ? ((allowance.remainingCredits ?? 0) / allowance.monthlyCredits) * 100
        : 0,
      hasCreditBalance: !!me.creditBalance,
    },
    source: 'api',
  };
}
