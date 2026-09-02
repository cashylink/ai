/**
 * LOQUIRA — billing & usage data for the website dashboard.
 * Reads server-written Firestore documents (creditBalances, subscriptions, plans, usage).
 * Never writes credits or subscription state from the client.
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  orderBy,
  limit,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { db } from './firebase-config.js';
import {
  getIdTokenForSaas,
  fetchSaasMe,
  fetchSaasPlans,
  mapSaasMeToSnapshot,
  postSaasPlanInterest,
} from './saas-api.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_CREDITS = {
  free: 500,
  starter: 3000,
  pro: 10000,
  business: 30000,
};

/** Default catalog when Firestore / API plans are empty (matches Agent Server seed). */
export const LOQUIRA_DEFAULT_PLANS = [
  {
    id: 'free',
    name: 'Free',
    priceEGP: 0,
    monthlyCredits: 500,
    allowedTiers: ['FAST'],
    active: true,
    sortOrder: 0,
    isDefault: true,
    features: ['500 Credits / month', 'Fast models', 'Basic agent', 'Vision'],
  },
  {
    id: 'starter',
    name: 'Starter',
    priceEGP: 149,
    monthlyCredits: 3000,
    allowedTiers: ['FAST', 'MEDIUM'],
    active: true,
    sortOrder: 1,
    features: ['3,000 Credits / month', 'Fast + Medium models', 'Full agent', 'Vision'],
  },
  {
    id: 'pro',
    name: 'Pro',
    priceEGP: 349,
    monthlyCredits: 10000,
    allowedTiers: ['FAST', 'MEDIUM', 'HIGH'],
    active: true,
    sortOrder: 2,
    features: ['10,000 Credits / month', 'Fast + Medium + High models', 'Advanced agent', 'Priority routing'],
  },
  {
    id: 'business',
    name: 'Business',
    priceEGP: 799,
    monthlyCredits: 30000,
    allowedTiers: ['FAST', 'MEDIUM', 'HIGH', 'PREMIUM'],
    active: true,
    sortOrder: 3,
    features: ['30,000 Credits / month', 'All tiers including Premium', 'Team-scale concurrency', 'Priority support'],
  },
];

export function getEffectivePlans(plans) {
  const list = Array.isArray(plans) ? plans.filter(function (p) { return p && p.active !== false; }) : [];
  if (list.length > 0) {
    return list.slice().sort(function (a, b) { return (a.sortOrder ?? 0) - (b.sortOrder ?? 0); });
  }
  return LOQUIRA_DEFAULT_PLANS.slice();
}

function monthKey(ts = Date.now()) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function dayKey(ts = Date.now()) {
  return new Date(ts).toISOString().slice(0, 10);
}

export async function fetchPlansCatalog() {
  try {
    const snap = await getDocs(collection(db, 'plans'));
    const plans = snap.docs.map(function (d) {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || d.id,
        priceEGP: data.priceEGP ?? data.priceUsd ?? 0,
        monthlyCredits: data.monthlyCredits ?? 0,
        allowedTiers: data.allowedTiers || [],
        active: data.active !== false,
        sortOrder: data.sortOrder ?? 0,
        isDefault: data.isDefault === true,
        features: data.features || [],
      };
    });
    return getEffectivePlans(plans);
  } catch (err) {
    console.warn('[LOQUIRA] Plans load failed:', err);
    return getEffectivePlans([]);
  }
}

export async function fetchSubscription(uid) {
  try {
    const ref = doc(db, 'subscriptions', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      planId: data.planId || 'free',
      status: data.status || 'active',
      periodStart: data.periodStart || null,
      renewalDate: data.renewalDate || data.currentPeriodEnd || null,
      autoRenew: data.autoRenew !== false,
    };
  } catch (err) {
    console.warn('[LOQUIRA] Subscription load failed:', err);
    return null;
  }
}

export async function fetchCreditBalance(uid) {
  try {
    const ref = doc(db, 'creditBalances', uid);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      planId: data.planId || 'free',
      monthlyCredits: data.monthlyCredits ?? 0,
      usedCredits: data.usedCredits ?? 0,
      reservedCredits: data.reservedCredits ?? 0,
      remainingCredits: data.remainingCredits ?? 0,
      periodStart: data.periodStart || null,
      periodEnd: data.periodEnd || null,
      updatedAt: data.updatedAt || null,
    };
  } catch (err) {
    console.warn('[LOQUIRA] Credit balance load failed:', err);
    return null;
  }
}

export async function fetchUsageMonthly(uid, month) {
  const key = month || monthKey();
  try {
    const ref = doc(db, 'usageMonthly', `${uid}__${key}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      month: data.month || key,
      creditsUsed: data.creditsUsed ?? 0,
      requests: data.requests ?? 0,
      byModel: data.byModel || {},
    };
  } catch (err) {
    console.warn('[LOQUIRA] Usage monthly load failed:', err);
    return null;
  }
}

export async function fetchUsageDaily(uid, day) {
  const key = day || dayKey();
  try {
    const ref = doc(db, 'usageDaily', `${uid}__${key}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data();
    return {
      creditsUsed: data.creditsUsed ?? 0,
      requests: data.requests ?? 0,
      estimatedCostUSD: data.estimatedCostUSD ?? null,
    };
  } catch (err) {
    return null;
  }
}

export async function fetchRecentUsage(uid, maxItems = 20) {
  try {
    const q = query(
      collection(db, 'usage'),
      where('userId', '==', uid),
      orderBy('createdAt', 'desc'),
      limit(maxItems),
    );
    const snap = await getDocs(q);
    return snap.docs.map(function (d) {
      const data = d.data();
      return {
        id: d.id,
        model: data.model || 'Unknown',
        credits: data.credits ?? 0,
        status: data.status || 'success',
        createdAt: data.createdAt || null,
        costUsd: data.costUsd ?? null,
      };
    });
  } catch (err) {
    if (err.code === 'failed-precondition') {
      console.warn('[LOQUIRA] Usage index missing — deploy Firestore indexes for usage.userId + createdAt');
    }
    return [];
  }
}

export async function fetchCreditProducts() {
  try {
    const snap = await getDocs(collection(db, 'creditProducts'));
    const products = snap.docs.map(function (d) {
      const data = d.data();
      return {
        id: d.id,
        name: data.name || d.id,
        credits: data.credits ?? 0,
        priceEGP: data.priceEGP ?? 0,
        active: data.active !== false,
        sortOrder: data.sortOrder ?? 0,
      };
    });
    products.sort(function (a, b) { return a.sortOrder - b.sortOrder; });
    return products.filter(function (p) { return p.active; });
  } catch {
    return [];
  }
}

/** Combined account snapshot for dashboard / billing / usage pages. */
export async function fetchAccountSnapshot(uid) {
  try {
    const idToken = await getIdTokenForSaas();
    if (idToken) {
      const [me, recentUsage, creditProducts] = await Promise.all([
        fetchSaasMe(idToken),
        fetchRecentUsage(uid, 15),
        fetchCreditProducts(),
      ]);
      if (me?.allowance) {
        const snapshot = mapSaasMeToSnapshot(me, recentUsage, creditProducts);
        if (!snapshot.plans?.length) {
          try {
            const plansPayload = await fetchSaasPlans(idToken);
            snapshot.plans = getEffectivePlans(plansPayload?.plans || plansPayload);
          } catch {
            snapshot.plans = getEffectivePlans([]);
          }
        } else {
          snapshot.plans = getEffectivePlans(snapshot.plans);
        }
        return snapshot;
      }
    }
  } catch (err) {
    console.warn('[LOQUIRA] SaaS API unavailable, using Firestore:', err?.status || err?.message || err);
  }

  const [plans, subscription, creditBalance, usageMonthly, recentUsage, creditProducts] = await Promise.all([
    fetchPlansCatalog(),
    fetchSubscription(uid),
    fetchCreditBalance(uid),
    fetchUsageMonthly(uid),
    fetchRecentUsage(uid, 15),
    fetchCreditProducts(),
  ]);

  const effectivePlans = getEffectivePlans(plans);
  const planId = creditBalance?.planId || subscription?.planId || 'free';
  const plan = effectivePlans.find(function (p) { return p.id === planId; })
    || effectivePlans.find(function (p) { return p.isDefault; })
    || effectivePlans[0]
    || null;

  const monthlyCredits = creditBalance?.monthlyCredits ?? plan?.monthlyCredits ?? 0;
  const usedCredits = creditBalance?.usedCredits ?? usageMonthly?.creditsUsed ?? 0;
  const remainingCredits = creditBalance
    ? creditBalance.remainingCredits
    : Math.max(0, monthlyCredits - usedCredits);
  const requests = usageMonthly?.requests ?? 0;

  let estimatedCostUSD = null;
  let costSum = 0;
  let costCount = 0;
  recentUsage.forEach(function (u) {
    if (typeof u.costUsd === 'number' && u.costUsd > 0) {
      costSum += u.costUsd;
      costCount += 1;
    }
  });
  if (costCount > 0 && usageMonthly) {
    estimatedCostUSD = costSum;
  }

  return {
    plans: effectivePlans,
    plan,
    subscription,
    creditBalance,
    usageMonthly,
    recentUsage,
    creditProducts,
    summary: {
      planId,
      planName: plan?.name || planId,
      priceEGP: plan?.priceEGP ?? 0,
      monthlyCredits,
      usedCredits,
      remainingCredits,
      requests,
      estimatedCostUSD,
      percentRemaining: monthlyCredits > 0 ? (remainingCredits / monthlyCredits) * 100 : 0,
      hasCreditBalance: !!creditBalance,
    },
    source: 'firestore',
  };
}

/** Activate plan: Worker API first, Firestore fallback (rules-validated writes). */
export async function activatePlan(uid, plan) {
  if (!uid || !plan?.id) throw new Error('INVALID_PLAN');

  const idToken = await getIdTokenForSaas(true);
  if (idToken) {
    try {
      return await postSaasPlanInterest(idToken, plan);
    } catch (err) {
      console.warn('[LOQUIRA] Worker activate failed, using Firestore:', err?.status || err?.message || err);
    }
  }

  return activatePlanViaFirestore(uid, plan);
}

async function activatePlanViaFirestore(uid, plan) {
  const planId = String(plan.id).toLowerCase();
  const monthlyCredits = Number(plan.monthlyCredits) || PLAN_CREDITS[planId] || 0;
  if (!PLAN_CREDITS[planId]) throw new Error('INVALID_PLAN');

  const now = Date.now();
  const periodEnd = now + 30 * DAY_MS;
  const planName = plan.name || planId;

  const subRef = doc(db, 'subscriptions', uid);
  const existingSub = await getDoc(subRef);
  const subscription = {
    id: uid,
    userId: uid,
    planId,
    status: 'active',
    periodStart: now,
    renewalDate: periodEnd,
    autoRenew: true,
    paymentProvider: 'none',
    updatedAt: now,
  };
  if (!existingSub.exists()) {
    subscription.createdAt = now;
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

  await Promise.all([
    setDoc(subRef, subscription, { merge: true }),
    setDoc(doc(db, 'creditBalances', uid), creditBalance, { merge: true }),
    setDoc(doc(db, 'users', uid, 'planInterest', planId), {
      userId: uid,
      planId,
      planName,
      monthlyCredits,
      status: 'active',
      activatedAt: now,
    }, { merge: true }),
  ]);

  return {
    ok: true,
    changed: true,
    planId,
    planName,
    status: 'active',
    allowance: {
      planId,
      planName,
      monthlyCredits,
      usedCredits: 0,
      remainingCredits: monthlyCredits,
    },
  };
}

export function formatCredits(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString();
}

export function formatEgp(n) {
  if (n === null || n === undefined) return '—';
  return Number(n).toLocaleString() + ' EGP';
}

export function formatUsageTime(ts) {
  if (!ts) return 'Recently';
  const date = typeof ts === 'number' ? new Date(ts) : ts.toDate?.() || new Date(ts);
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return mins + ' min ago';
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + 'h ago';
  return date.toLocaleDateString();
}
