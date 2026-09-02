import { watchAuth, logOut } from './auth.js';
import { initAnalytics, db } from './firebase-config.js';
import { doc, setDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  fetchProjects,
  createProject,
  touchProject,
  fetchAgentActivity,
  ensureLoquiraModels,
  formatRelativeTime,
  getProjectTypeLabel,
} from './dashboard-store.js';
import { groupModels } from './loquira-models.js';

import {
  fetchAccountSnapshot,
  formatCredits,
  formatEgp,
  formatUsageTime,
  getEffectivePlans,
} from './saas-store.js';
import { getIdTokenForSaas, postSaasPlanInterest } from './saas-api.js';

initAnalytics();

const VIEWS = ['overview', 'projects', 'agents', 'models', 'usage', 'billing', 'settings'];
const VIEW_TITLES = {
  overview: 'Overview',
  projects: 'Projects',
  agents: 'Agent',
  models: 'Models',
  usage: 'Usage',
  billing: 'Billing',
  settings: 'Settings',
};

let currentUser = null;
let dashboardData = {
  projects: [],
  agents: [],
  models: [],
  projectsState: 'loading',
  agentsState: 'loading',
  modelsState: 'loading',
  accountState: 'loading',
  account: null,
};

const loadingEl = document.getElementById('dash-loading');
const appEl = document.getElementById('dash-app');
const sidebarEl = document.getElementById('dash-sidebar');
const backdropEl = document.getElementById('sidebar-backdrop');
const menuToggle = document.getElementById('menu-toggle');
const headerTitle = document.getElementById('header-view-title');
const signOutBtn = document.getElementById('sign-out-btn');
const userMenuTrigger = document.getElementById('user-menu-trigger');
const userDropdown = document.getElementById('user-dropdown');
const projectModal = document.getElementById('project-modal');
const projectForm = document.getElementById('project-form');
const modalCancel = document.getElementById('modal-cancel');
const modalAlert = document.getElementById('modal-alert');
const modalSubmit = document.getElementById('modal-submit');
const newProjectHeaderBtn = document.getElementById('new-project-header-btn');
const planModal = document.getElementById('plan-modal');
const planModalTitle = document.getElementById('plan-modal-title');
const planModalText = document.getElementById('plan-modal-text');
const planModalConfirm = document.getElementById('plan-modal-confirm');
const planModalCancel = document.getElementById('plan-modal-cancel');

let selectedBillingPlanId = null;
let pendingPlanSelection = null;

function formatTierLabel(tier) {
  const labels = {
    FAST: 'Fast',
    MEDIUM: 'Medium',
    HIGH: 'High',
    PREMIUM: 'Premium',
  };
  return labels[tier] || tier;
}

function renderPlanFeatures(plan) {
  const features = Array.isArray(plan.features) && plan.features.length
    ? plan.features
    : [
      formatCredits(plan.monthlyCredits) + ' Credits / month',
      (plan.allowedTiers || []).map(formatTierLabel).join(', ') + ' models',
    ];
  return features.map(function (feature) {
    return '<li>' + escapeHtml(feature) + '</li>';
  }).join('');
}

function closePlanModal() {
  if (!planModal) return;
  planModal.classList.remove('open');
  planModal.hidden = true;
  pendingPlanSelection = null;
  if (planModalConfirm) planModalConfirm.disabled = false;
}

function openPlanModal(plan) {
  if (!planModal || !plan) return;
  pendingPlanSelection = plan;
  const priceLine = plan.priceEGP > 0 ? formatEgp(plan.priceEGP) + ' / month' : 'Free';
  if (planModalTitle) planModalTitle.textContent = 'Subscribe to LOQUIRA ' + plan.name;
  if (planModalText) {
    planModalText.innerHTML =
      '<strong>' + escapeHtml(priceLine) + '</strong> — ' +
      formatCredits(plan.monthlyCredits) + ' Credits per month.<br><br>' +
      'Online checkout is being finalized. Confirm your choice and we will save your plan preference. ' +
      'You will be notified when payment is available — no charge until then.';
  }
  if (planModalConfirm) {
    planModalConfirm.textContent = 'Confirm selection';
    planModalConfirm.disabled = false;
  }
  planModal.hidden = false;
  planModal.classList.add('open');
  planModalConfirm?.focus();
}

async function savePlanInterest(plan) {
  if (!currentUser || !plan) return;

  const idToken = await getIdTokenForSaas(true);
  if (idToken) {
    try {
      await postSaasPlanInterest(idToken, plan);
      return;
    } catch (err) {
      console.warn('[LOQUIRA] Worker plan-interest failed, trying Firestore:', err?.status || err?.message || err);
    }
  }

  const ref = doc(db, 'users', currentUser.uid, 'planInterest', plan.id);
  await setDoc(ref, {
    planId: plan.id,
    planName: plan.name,
    priceEGP: plan.priceEGP ?? 0,
    monthlyCredits: plan.monthlyCredits ?? 0,
    requestedAt: serverTimestamp(),
    email: currentUser.email || null,
    status: 'pending_payment',
  }, { merge: true });
}

async function handlePlanModalConfirm() {
  const plan = pendingPlanSelection;
  if (!plan || !planModalConfirm) return;

  planModalConfirm.disabled = true;
  planModalConfirm.textContent = 'Saving…';

  try {
    await savePlanInterest(plan);
    selectedBillingPlanId = plan.id;
    if (planModalText) {
      planModalText.innerHTML =
        '<span class="dash-badge completed">Plan preference saved</span><br><br>' +
        'You selected <strong>LOQUIRA ' + escapeHtml(plan.name) + '</strong>. ' +
        'We will notify you when checkout is ready.';
    }
    if (planModalTitle) planModalTitle.textContent = 'Selection saved';
    planModalConfirm.textContent = 'Done';
    planModalConfirm.disabled = false;
    renderBillingView();
  } catch (err) {
    console.error('[LOQUIRA] Plan interest save failed:', err);
    if (planModalText) {
      planModalText.textContent = 'Could not save your selection. Please try again.';
    }
    planModalConfirm.disabled = false;
    planModalConfirm.textContent = 'Try again';
  }
}

function bindBillingViewEvents() {
  const container = document.getElementById('billing-container');
  if (!container) return;

  container.querySelectorAll('[data-select-plan]').forEach(function (card) {
    card.addEventListener('click', function (e) {
      if (e.target.closest('[data-plan-action]')) return;
      selectedBillingPlanId = card.dataset.selectPlan;
      container.querySelectorAll('[data-select-plan]').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.selectPlan === selectedBillingPlanId);
      });
      updateBillingContinueButton();
    });
  });

  container.querySelector('#billing-continue-btn')?.addEventListener('click', function () {
    const plans = getEffectivePlans(dashboardData.account?.plans || []);
    const currentPlanId = dashboardData.account?.summary?.planId || 'free';
    const plan = plans.find(function (p) { return p.id === selectedBillingPlanId; });
    if (!plan) return;

    if (plan.id === currentPlanId) {
      if (planModalTitle) planModalTitle.textContent = 'Current plan';
      if (planModalText) {
        planModalText.textContent = 'You are already on LOQUIRA ' + plan.name + '.';
      }
      if (planModalConfirm) planModalConfirm.textContent = 'OK';
      pendingPlanSelection = null;
      planModal.hidden = false;
      planModal.classList.add('open');
      return;
    }

    if (plan.priceEGP <= 0) {
      if (planModalTitle) planModalTitle.textContent = 'LOQUIRA Free';
      if (planModalText) {
        planModalText.textContent =
          'LOQUIRA Free is your default plan. Paid checkout is required to upgrade to Starter, Pro, or Business.';
      }
      if (planModalConfirm) planModalConfirm.textContent = 'OK';
      pendingPlanSelection = null;
      planModal.hidden = false;
      planModal.classList.add('open');
      return;
    }

    openPlanModal(plan);
  });

  container.querySelectorAll('[data-plan-action]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      selectedBillingPlanId = btn.dataset.planAction;
      container.querySelectorAll('[data-select-plan]').forEach(function (el) {
        el.classList.toggle('selected', el.dataset.selectPlan === selectedBillingPlanId);
      });
      updateBillingContinueButton();
      container.querySelector('#billing-continue-btn')?.click();
    });
  });
}

function updateBillingContinueButton() {
  const btn = document.getElementById('billing-continue-btn');
  if (!btn) return;
  const plans = getEffectivePlans(dashboardData.account?.plans || []);
  const plan = plans.find(function (p) { return p.id === selectedBillingPlanId; });
  if (!plan) {
    btn.disabled = true;
    btn.textContent = 'Select a plan';
    return;
  }
  const currentPlanId = dashboardData.account?.summary?.planId || 'free';
  btn.disabled = false;
  if (plan.id === currentPlanId) {
    btn.textContent = 'Current plan';
  } else if (plan.priceEGP <= 0) {
    btn.textContent = 'Switch to Free';
  } else {
    btn.textContent = 'Continue with ' + plan.name;
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFirstName(user) {
  if (user.displayName) return user.displayName.split(' ')[0];
  return user.email.split('@')[0];
}

function setUserUI(user) {
  const name = user.displayName || user.email.split('@')[0];
  const initial = name.charAt(0).toUpperCase();

  document.getElementById('greeting-name').textContent = getFirstName(user);
  document.getElementById('greeting-text').textContent = getGreeting();

  ['sidebar-avatar', 'header-avatar'].forEach(function (id) {
    document.getElementById(id).textContent = initial;
  });

  ['sidebar-name', 'header-name', 'dropdown-name'].forEach(function (id) {
    document.getElementById(id).textContent = name;
  });

  ['sidebar-email', 'dropdown-email'].forEach(function (id) {
    document.getElementById(id).textContent = user.email;
  });
}

function showApp() {
  loadingEl.style.display = 'none';
  appEl.style.display = 'flex';
  appEl.hidden = false;
}

function navigateTo(view) {
  if (!VIEWS.includes(view)) view = 'overview';

  document.querySelectorAll('.dash-view').forEach(function (el) {
    el.classList.remove('active');
  });
  document.getElementById('view-' + view)?.classList.add('active');

  document.querySelectorAll('.dash-nav-item[data-view]').forEach(function (btn) {
    const isActive = btn.dataset.view === view;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'page' : null);
  });

  headerTitle.textContent = VIEW_TITLES[view] || 'Overview';
  history.replaceState(null, '', '#' + view);
  closeSidebar();
  closeUserMenu();
}

function openSidebar() {
  sidebarEl.classList.add('open');
  backdropEl.classList.add('open');
  menuToggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebarEl.classList.remove('open');
  backdropEl.classList.remove('open');
  menuToggle.setAttribute('aria-expanded', 'false');
}

function openUserMenu() {
  userDropdown.classList.add('open');
  userMenuTrigger.setAttribute('aria-expanded', 'true');
}

function closeUserMenu() {
  userDropdown.classList.remove('open');
  userMenuTrigger.setAttribute('aria-expanded', 'false');
}

function openProjectModal(type) {
  const typeSelect = document.getElementById('project-type');
  if (typeSelect) typeSelect.value = type || 'app';
  modalAlert.classList.remove('visible');
  projectModal.hidden = false;
  projectModal.classList.add('open');
  document.getElementById('project-name').focus();
}

function closeProjectModal() {
  projectModal.classList.remove('open');
  projectModal.hidden = true;
  projectForm.reset();
  modalSubmit.disabled = false;
  modalSubmit.textContent = 'Create project';
}

function renderSkeleton(count) {
  let html = '<div class="dash-project-list">';
  for (let i = 0; i < count; i++) {
    html += '<div class="dash-skeleton"></div>';
  }
  html += '</div>';
  return html;
}

function renderEmptyState(title, message, ctaLabel, ctaAction) {
  let html = '<div class="dash-state"><h3>' + escapeHtml(title) + '</h3><p>' + escapeHtml(message) + '</p>';
  if (ctaLabel && ctaAction) {
    html += '<button type="button" class="dash-btn-primary" data-action="' + ctaAction + '">' + escapeHtml(ctaLabel) + '</button>';
  }
  html += '</div>';
  return html;
}

function renderProjectsErrorState() {
  return (
    '<div class="dash-state error">' +
      '<h3>Couldn\'t load your projects</h3>' +
      '<p>Something went wrong while loading your projects. Please try again.</p>' +
      '<button type="button" class="dash-btn-secondary" id="retry-projects">Retry</button>' +
    '</div>'
  );
}

function bindRetryProjects(container) {
  container.querySelector('#retry-projects')?.addEventListener('click', function () {
    loadProjects();
  });
}

function renderProjectCard(project, showOpen) {
  return (
    '<div class="dash-project-card">' +
      '<div class="dash-project-info">' +
        '<h3>' + escapeHtml(project.name) + '</h3>' +
        '<div class="dash-project-meta">' +
          '<span>' + formatRelativeTime(project.updatedAt) + '</span>' +
          '<span class="dash-project-type">' + escapeHtml(getProjectTypeLabel(project.type)) + '</span>' +
        '</div>' +
      '</div>' +
      (showOpen
        ? '<button type="button" class="dash-btn-secondary" data-open-project="' + project.id + '">Open</button>'
        : '') +
    '</div>'
  );
}

function renderProjectsList(container, projects, options) {
  options = options || {};
  if (dashboardData.projectsState === 'loading') {
    container.innerHTML = renderSkeleton(options.limit || 3);
    return;
  }
  if (dashboardData.projectsState === 'error') {
    container.innerHTML = renderProjectsErrorState();
    bindRetryProjects(container);
    return;
  }
  const list = options.limit ? projects.slice(0, options.limit) : projects;
  if (list.length === 0) {
    container.innerHTML = renderEmptyState(
      'No projects yet.',
      'Start your first project with LOQUIRA.',
      'Create project',
      'new-project'
    );
    return;
  }
  container.innerHTML =
    '<div class="dash-project-list">' +
    list.map(function (p) { return renderProjectCard(p, options.showOpen !== false); }).join('') +
    '</div>';
}

function renderAgentsList(container, agents, options) {
  options = options || {};
  if (dashboardData.agentsState === 'loading') {
    container.innerHTML = renderSkeleton(options.limit || 3);
    return;
  }
  const list = options.limit ? agents.slice(0, options.limit) : agents;
  if (list.length === 0) {
    container.innerHTML = renderEmptyState(
      'No agent activity yet.',
      'Start a task with LOQUIRA and your recent work will appear here.',
      'Ask LOQUIRA',
      'ask-agent'
    );
    return;
  }
  container.innerHTML =
    '<div class="dash-project-list">' +
    list.map(function (a) {
      const statusClass = a.status === 'in-progress' ? 'in-progress' : a.status === 'failed' ? 'failed' : 'completed';
      const filesText = a.filesChanged > 0 ? a.filesChanged + ' file' + (a.filesChanged === 1 ? '' : 's') + ' changed' : '';
      return (
        '<div class="dash-activity-item">' +
          '<div>' +
            '<div class="dash-activity-title">' + escapeHtml(a.title) + '</div>' +
            '<div class="dash-activity-meta">' +
              (filesText ? escapeHtml(filesText) + ' · ' : '') +
              formatRelativeTime(a.updatedAt) +
            '</div>' +
          '</div>' +
          '<span class="dash-badge ' + statusClass + '">' + escapeHtml(a.status.replace('-', ' ')) + '</span>' +
        '</div>'
      );
    }).join('') +
    '</div>';
}

function updateStats() {
  const projectsCard = document.getElementById('stat-card-projects');
  const agentsCard = document.getElementById('stat-card-agents');
  const loadingCard = document.getElementById('stat-card-loading');
  const statsRow = document.getElementById('overview-stats');

  const projectsLoading = dashboardData.projectsState === 'loading';
  const agentsLoading = dashboardData.agentsState === 'loading';

  if (projectsLoading && agentsLoading) {
    statsRow.hidden = false;
    projectsCard.hidden = true;
    agentsCard.hidden = true;
    loadingCard.hidden = false;
    return;
  }

  loadingCard.hidden = true;
  let visibleCount = 0;

  if (dashboardData.projectsState === 'loaded') {
    projectsCard.hidden = false;
    document.getElementById('stat-projects').textContent = String(dashboardData.projects.length);
    visibleCount++;
  } else {
    projectsCard.hidden = true;
  }

  if (dashboardData.agentsState === 'loaded') {
    agentsCard.hidden = false;
    document.getElementById('stat-agents').textContent = String(dashboardData.agents.length);
    visibleCount++;
  } else {
    agentsCard.hidden = true;
  }

  statsRow.hidden = visibleCount === 0;
}

function renderModelCard(model) {
  const caps = Array.isArray(model.capabilities) ? model.capabilities.join(' · ') : '';

  return (
    '<div class="dash-model-card">' +
      '<h3>' + escapeHtml(model.name) + '</h3>' +
      '<p class="dash-model-meta">' +
        escapeHtml(model.group) +
        (caps ? ' · ' + escapeHtml(caps) : '') +
      '</p>' +
      (model.detail ? '<p class="dash-model-detail">' + escapeHtml(model.detail) + '</p>' : '') +
    '</div>'
  );
}

function renderModelsView() {
  const container = document.getElementById('models-container');
  if (dashboardData.modelsState === 'loading') {
    container.innerHTML = renderSkeleton(3);
    return;
  }

  const models = dashboardData.models;
  if (!models || models.length === 0) {
    container.innerHTML = renderEmptyState(
      'No models available',
      'LOQUIRA models will appear here shortly.',
      null,
      null
    );
    return;
  }

  const grouped = groupModels(models);

  let html =
    '<div class="dash-models-summary">' +
      '<span>' + models.length + ' models</span>' +
      '<span class="dash-models-summary-hint">Select a model in the LOQUIRA desktop app</span>' +
    '</div>';

  grouped.forEach(function (section) {
    html +=
      '<section class="dash-model-group" aria-label="' + escapeHtml(section.group) + ' models">' +
        '<h2 class="dash-model-group-title">' + escapeHtml(section.group) + '</h2>' +
        '<div class="dash-model-grid">' +
          section.models.map(renderModelCard).join('') +
        '</div>' +
      '</section>';
  });

  container.innerHTML = html;
}

function renderPlanSummary() {
  const container = document.getElementById('plan-summary-container');
  if (!container) return;

  if (dashboardData.accountState === 'loading') {
    container.innerHTML = '<div class="dash-plan-card dash-skeleton" style="height:140px;border-radius:14px;"></div>';
    return;
  }

  const snap = dashboardData.account?.summary;
  if (!snap) {
    container.innerHTML = '';
    return;
  }

  const pct = Math.min(100, Math.max(0, snap.percentRemaining));
  const priceLine = snap.priceEGP > 0 ? formatEgp(snap.priceEGP) + ' / month' : 'Free';

  container.innerHTML =
    '<div class="dash-plan-card">' +
      '<div class="dash-plan-card-header">' +
        '<div>' +
          '<div class="dash-plan-label">Current Plan</div>' +
          '<div class="dash-plan-name">LOQUIRA ' + escapeHtml(snap.planName) + '</div>' +
          '<div class="dash-plan-price">' + escapeHtml(priceLine) + '</div>' +
        '</div>' +
        '<button type="button" class="dash-btn-secondary" data-view="billing">Upgrade Plan</button>' +
      '</div>' +
      '<div class="dash-credits-row">' +
        '<div class="dash-credits-main">' +
          '<span class="dash-credits-remaining">' + formatCredits(snap.remainingCredits) + '</span>' +
          '<span class="dash-credits-label">Credits remaining</span>' +
        '</div>' +
        '<div class="dash-credits-sub">of ' + formatCredits(snap.monthlyCredits) + '</div>' +
      '</div>' +
      '<div class="dash-progress" role="progressbar" aria-valuenow="' + pct.toFixed(1) + '" aria-valuemin="0" aria-valuemax="100">' +
        '<div class="dash-progress-fill" style="width:' + pct + '%"></div>' +
      '</div>' +
      '<div class="dash-plan-stats">' +
        '<div><span class="dash-plan-stat-value">' + formatCredits(snap.usedCredits) + '</span><span class="dash-plan-stat-label">Used this month</span></div>' +
        '<div><span class="dash-plan-stat-value">' + formatCredits(snap.requests) + '</span><span class="dash-plan-stat-label">AI requests</span></div>' +
        (snap.estimatedCostUSD !== null
          ? '<div><span class="dash-plan-stat-value">$' + snap.estimatedCostUSD.toFixed(2) + '</span><span class="dash-plan-stat-label">Est. AI cost</span></div>'
          : '') +
      '</div>' +
      '<div class="dash-plan-actions">' +
        '<button type="button" class="dash-btn-ghost" data-view="usage">View Usage</button>' +
      '</div>' +
    '</div>';
}

function renderUsageView() {
  const container = document.getElementById('usage-container');
  if (!container) return;

  if (dashboardData.accountState === 'loading') {
    container.innerHTML = renderSkeleton(3);
    return;
  }

  const snap = dashboardData.account;
  if (!snap?.summary) {
    container.innerHTML = renderEmptyState('Usage unavailable', 'Open LOQUIRA Desktop and send an AI request to start tracking usage.', null, null);
    return;
  }

  if (!snap.summary.hasCreditBalance) {
    container.innerHTML =
      '<div class="dash-state">' +
        '<h3>Credits not activated yet</h3>' +
        '<p>Sign in to LOQUIRA Desktop and send your first AI request. Your credits will appear here automatically.</p>' +
      '</div>';
    return;
  }

  const s = snap.summary;
  const byModel = snap.usageMonthly?.byModel || {};
  const modelRows = Object.keys(byModel).sort(function (a, b) {
    return (byModel[b].credits || 0) - (byModel[a].credits || 0);
  });

  let html =
    '<div class="dash-usage-grid">' +
      '<div class="dash-stat-card"><div class="dash-stat-label">Credits used</div><div class="dash-stat-value">' + formatCredits(s.usedCredits) + '</div></div>' +
      '<div class="dash-stat-card"><div class="dash-stat-label">Credits remaining</div><div class="dash-stat-value">' + formatCredits(s.remainingCredits) + '</div></div>' +
      '<div class="dash-stat-card"><div class="dash-stat-label">Requests</div><div class="dash-stat-value">' + formatCredits(s.requests) + '</div></div>' +
    '</div>';

  html += '<div class="dash-section"><h2>Usage by Model</h2>';
  if (modelRows.length === 0) {
    html += '<p class="dash-muted">No model usage recorded this month yet.</p>';
  } else {
    html += '<table class="dash-table"><thead><tr><th>Model</th><th>Credits</th></tr></thead><tbody>';
    modelRows.forEach(function (modelId) {
      html += '<tr><td>' + escapeHtml(modelId) + '</td><td>' + formatCredits(byModel[modelId].credits) + '</td></tr>';
    });
    html += '</tbody></table>';
  }
  html += '</div>';

  html += '<div class="dash-section"><h2>Recent activity</h2>';
  if (!snap.recentUsage?.length) {
    html += '<p class="dash-muted">No recent AI requests.</p>';
  } else {
    html += '<div class="dash-activity-list">';
    snap.recentUsage.forEach(function (item) {
      html +=
        '<div class="dash-activity-item">' +
          '<div><div class="dash-activity-title">' + escapeHtml(item.model) + '</div>' +
          '<div class="dash-activity-meta">' + formatUsageTime(item.createdAt) + '</div></div>' +
          '<div class="dash-activity-credits">' + formatCredits(item.credits) + ' Credits</div>' +
          '<span class="dash-badge completed">' + escapeHtml(item.status) + '</span>' +
        '</div>';
    });
    html += '</div>';
  }
  html += '</div>';

  container.innerHTML = html;
}

function renderBillingView() {
  const container = document.getElementById('billing-container');
  if (!container) return;

  if (dashboardData.accountState === 'loading') {
    container.innerHTML = renderSkeleton(2);
    return;
  }

  const snap = dashboardData.account;
  const s = snap?.summary;
  const allPlans = getEffectivePlans(snap?.plans || []);

  if (!s) {
    container.innerHTML = renderEmptyState('Billing unavailable', 'Unable to load billing data.', null, null);
    return;
  }

  if (!selectedBillingPlanId) {
    selectedBillingPlanId = s.planId || allPlans[0]?.id || 'free';
  }

  const renewal = dashboardData.account?.subscription?.renewalDate;
  const renewalText = renewal ? new Date(renewal).toLocaleDateString() : '—';

  let html =
    '<div class="dash-billing-current">' +
      '<h2>Current plan</h2>' +
      '<div class="dash-plan-card compact">' +
        '<div class="dash-plan-name">LOQUIRA ' + escapeHtml(s.planName) + '</div>' +
        '<div class="dash-plan-price">' + escapeHtml(s.priceEGP > 0 ? formatEgp(s.priceEGP) + ' / month' : 'Free') + '</div>' +
        '<p class="dash-muted">Next renewal: ' + escapeHtml(renewalText) + '</p>' +
        '<p class="dash-muted">' + formatCredits(s.remainingCredits) + ' of ' + formatCredits(s.monthlyCredits) + ' Credits remaining</p>' +
      '</div>' +
    '</div>';

  html += '<div class="dash-section"><h2>Choose a plan</h2><p class="dash-muted">Select a plan below, then continue. Online payment will be enabled soon.</p>';
  html += '<div class="dash-plans-grid">';
  allPlans.forEach(function (plan) {
    const isCurrent = plan.id === s.planId;
    const isSelected = plan.id === selectedBillingPlanId;
    html +=
      '<div class="dash-plan-option' + (isCurrent ? ' current' : '') + (isSelected ? ' selected' : '') + '" data-select-plan="' + escapeHtml(plan.id) + '" role="button" tabindex="0">' +
        '<div class="dash-plan-option-header">' +
          '<h3>LOQUIRA ' + escapeHtml(plan.name) + '</h3>' +
          (isCurrent ? '<span class="dash-badge completed">Current</span>' : '') +
        '</div>' +
        '<div class="dash-plan-option-price">' + (plan.priceEGP > 0 ? formatEgp(plan.priceEGP) + '/mo' : 'Free') + '</div>' +
        '<p class="dash-muted">' + formatCredits(plan.monthlyCredits) + ' Credits / month</p>' +
        '<ul class="dash-plan-features">' + renderPlanFeatures(plan) + '</ul>' +
        (isCurrent
          ? '<button type="button" class="dash-btn-ghost" data-plan-action="' + escapeHtml(plan.id) + '">View plan</button>'
          : '<button type="button" class="dash-btn-secondary" data-plan-action="' + escapeHtml(plan.id) + '">Select ' + escapeHtml(plan.name) + '</button>') +
      '</div>';
  });
  html += '</div>';
  html += '<div class="dash-billing-actions">' +
    '<button type="button" class="dash-btn-primary" id="billing-continue-btn">Select a plan</button>' +
  '</div></div>';

  const products = snap.creditProducts || [];
  if (products.length) {
    html += '<div class="dash-section"><h2>Credit packs</h2><div class="dash-plans-grid">';
    products.forEach(function (p) {
      html +=
        '<div class="dash-plan-option">' +
          '<h3>' + escapeHtml(p.name) + '</h3>' +
          '<div class="dash-plan-option-price">' + formatEgp(p.priceEGP) + '</div>' +
          '<button type="button" class="dash-btn-secondary" disabled title="Coming soon">Buy credits</button>' +
        '</div>';
    });
    html += '</div></div>';
  }

  container.innerHTML = html;
  bindBillingViewEvents();
  updateBillingContinueButton();
}

function renderOverview() {
  renderPlanSummary();
  renderProjectsList(document.getElementById('recent-projects-container'), dashboardData.projects, { limit: 4, showOpen: true });
  renderAgentsList(document.getElementById('recent-agents-container'), dashboardData.agents, { limit: 4 });
  updateStats();
}

function renderProjectsView() {
  renderProjectsList(document.getElementById('projects-container'), dashboardData.projects, { showOpen: true });
}

function renderAgentsView() {
  renderAgentsList(document.getElementById('agents-container'), dashboardData.agents);
}

function getAuthProviderLabel(user) {
  if (!user.providerData || user.providerData.length === 0) return 'Email';
  const provider = user.providerData[0].providerId;
  if (provider === 'google.com') return 'Google';
  if (provider === 'password') return 'Email & password';
  return provider;
}

function renderSettingsView() {
  const container = document.getElementById('settings-container');
  if (!currentUser) return;

  const profileName = currentUser.displayName || 'Not set';

  container.innerHTML =
    '<div class="dash-settings-group">' +
      '<h2>Account</h2>' +
      '<div class="dash-settings-card">' +
        '<div class="dash-settings-row"><label>Name</label><span class="value">' + escapeHtml(profileName) + '</span></div>' +
        '<div class="dash-settings-row"><label>Email</label><span class="value">' + escapeHtml(currentUser.email) + '</span></div>' +
        '<div class="dash-settings-row"><label>Authentication</label><span class="value">' + escapeHtml(getAuthProviderLabel(currentUser)) + '</span></div>' +
      '</div>' +
      '<button type="button" class="dash-btn-secondary dash-settings-signout" id="settings-sign-out">Sign out</button>' +
    '</div>';

  document.getElementById('settings-sign-out')?.addEventListener('click', handleSignOut);
}

function renderAll() {
  renderOverview();
  renderProjectsView();
  renderAgentsView();
  renderModelsView();
  renderUsageView();
  renderBillingView();
  renderSettingsView();
}

async function loadAccountData() {
  if (!currentUser) return;
  dashboardData.accountState = 'loading';
  renderPlanSummary();
  renderUsageView();
  renderBillingView();

  try {
    dashboardData.account = await fetchAccountSnapshot(currentUser.uid);
    dashboardData.accountState = 'loaded';
  } catch (err) {
    console.error('[LOQUIRA] Account load error:', err);
    dashboardData.account = null;
    dashboardData.accountState = 'error';
  }

  renderPlanSummary();
  renderUsageView();
  renderBillingView();
}

async function loadDashboardData() {
  await Promise.all([loadProjects(), loadAgents(), loadModels(), loadAccountData()]);
}

async function loadProjects() {
  if (!currentUser) return;
  dashboardData.projectsState = 'loading';
  renderOverview();
  renderProjectsView();

  try {
    dashboardData.projects = await fetchProjects(currentUser.uid);
    dashboardData.projectsState = 'loaded';
  } catch (err) {
    console.error('[LOQUIRA] Projects load error:', err);
    dashboardData.projects = [];
    dashboardData.projectsState = 'error';
  }

  renderOverview();
  renderProjectsView();
}

async function loadAgents() {
  if (!currentUser) return;
  dashboardData.agentsState = 'loading';
  renderOverview();
  renderAgentsView();

  try {
    dashboardData.agents = await fetchAgentActivity(currentUser.uid);
    dashboardData.agentsState = 'loaded';
  } catch (err) {
    console.error('[LOQUIRA] Agent activity load error:', err);
    dashboardData.agents = [];
    dashboardData.agentsState = 'loaded';
  }

  renderOverview();
  renderAgentsView();
}

async function loadModels() {
  if (!currentUser) return;
  dashboardData.modelsState = 'loading';
  renderModelsView();

  try {
    dashboardData.models = await ensureLoquiraModels(currentUser.uid);
    dashboardData.modelsState = 'loaded';
  } catch (err) {
    console.error('[LOQUIRA] Models load error:', err);
    dashboardData.models = [];
    dashboardData.modelsState = 'error';
  }

  renderModelsView();
}

async function handleCreateProject(e) {
  e.preventDefault();
  if (!currentUser) return;

  const name = document.getElementById('project-name').value.trim();
  const type = document.getElementById('project-type').value;

  if (!name) {
    modalAlert.textContent = 'Please enter a project name.';
    modalAlert.classList.add('visible');
    return;
  }

  modalSubmit.disabled = true;
  modalSubmit.textContent = 'Creating…';
  modalAlert.classList.remove('visible');

  try {
    await createProject(currentUser.uid, { name, type });
    closeProjectModal();
    await loadProjects();
    navigateTo('projects');
  } catch (err) {
    console.error('[LOQUIRA] Create project error:', err);
    modalAlert.textContent = 'Could not create project. Please try again.';
    modalAlert.classList.add('visible');
    modalSubmit.disabled = false;
    modalSubmit.textContent = 'Create project';
  }
}

function closeWorkspaceNotice() {
  const modal = document.getElementById('workspace-notice-modal');
  modal.classList.remove('open');
  modal.hidden = true;
}

function showWorkspaceNotice(projectName) {
  const modal = document.getElementById('workspace-notice-modal');
  document.getElementById('workspace-notice-text').textContent =
    '"' + projectName + '" is saved to your account. Open it in the LOQUIRA desktop workspace when connected.';
  modal.hidden = false;
  modal.classList.add('open');
}

function handleOpenProject(projectId) {
  const project = dashboardData.projects.find(function (p) { return p.id === projectId; });
  if (!project || !currentUser) return;

  touchProject(currentUser.uid, projectId).catch(function (err) {
    console.error('[LOQUIRA] Touch project error:', err);
  });
  showWorkspaceNotice(project.name);
}

function handleQuickAction(action) {
  switch (action) {
    case 'new-project':
      openProjectModal('app');
      break;
    case 'build-website':
      openProjectModal('website');
      break;
    case 'open-workspace':
      if (dashboardData.projectsState === 'loaded' && dashboardData.projects.length > 0) {
        handleOpenProject(dashboardData.projects[0].id);
      } else {
        openProjectModal('app');
      }
      break;
    case 'ask-agent':
      navigateTo('agents');
      break;
    case 'go-settings':
      navigateTo('settings');
      break;
    default:
      break;
  }
}

async function handleSignOut() {
  signOutBtn.disabled = true;
  try {
    await logOut();
    window.location.href = 'login.html';
  } catch (err) {
    console.error('[LOQUIRA] Sign out error:', err);
    signOutBtn.disabled = false;
  }
}

document.querySelectorAll('.dash-nav-item[data-view]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    navigateTo(btn.dataset.view);
  });
});

document.addEventListener('click', function (e) {
  const viewEl = e.target.closest('[data-view]');
  if (viewEl && !viewEl.classList.contains('dash-nav-item')) {
    e.preventDefault();
    navigateTo(viewEl.dataset.view);
    return;
  }

  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    handleQuickAction(actionEl.dataset.action);
    return;
  }

  const openEl = e.target.closest('[data-open-project]');
  if (openEl) {
    handleOpenProject(openEl.dataset.openProject);
  }
});

menuToggle.addEventListener('click', function () {
  if (sidebarEl.classList.contains('open')) closeSidebar();
  else openSidebar();
});

backdropEl.addEventListener('click', closeSidebar);

userMenuTrigger.addEventListener('click', function (e) {
  e.stopPropagation();
  if (userDropdown.classList.contains('open')) closeUserMenu();
  else openUserMenu();
});

document.addEventListener('click', function (e) {
  if (!e.target.closest('.dash-user-menu')) closeUserMenu();
});

signOutBtn.addEventListener('click', handleSignOut);

newProjectHeaderBtn.addEventListener('click', function () {
  openProjectModal('app');
});

modalCancel.addEventListener('click', closeProjectModal);
projectModal.addEventListener('click', function (e) {
  if (e.target === projectModal) closeProjectModal();
});
projectForm.addEventListener('submit', handleCreateProject);

document.getElementById('workspace-notice-close').addEventListener('click', closeWorkspaceNotice);
document.getElementById('workspace-notice-modal').addEventListener('click', function (e) {
  if (e.target.id === 'workspace-notice-modal') closeWorkspaceNotice();
});

planModalCancel?.addEventListener('click', closePlanModal);
planModal?.addEventListener('click', function (e) {
  if (e.target === planModal) closePlanModal();
});
planModalConfirm?.addEventListener('click', function () {
  const label = planModalConfirm.textContent || '';
  if (label === 'Done' || label === 'OK') {
    closePlanModal();
    return;
  }
  handlePlanModalConfirm();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeProjectModal();
    closeWorkspaceNotice();
    closePlanModal();
    closeSidebar();
    closeUserMenu();
  }
});

window.addEventListener('hashchange', function () {
  const view = location.hash.replace('#', '') || 'overview';
  navigateTo(view);
});

watchAuth(function (user) {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  currentUser = user;
  setUserUI(user);
  showApp();

  const initialView = location.hash.replace('#', '') || 'overview';
  navigateTo(VIEWS.includes(initialView) ? initialView : 'overview');
  loadDashboardData();
  renderSettingsView();
});
