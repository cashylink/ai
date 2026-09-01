import { watchAuth, logOut } from './auth.js';
import { initAnalytics } from './firebase-config.js';
import {
  fetchProjects,
  createProject,
  touchProject,
  fetchAgentActivity,
  fetchUserSettings,
  saveProviderSetting,
  formatRelativeTime,
  getProjectTypeLabel,
} from './dashboard-store.js';

initAnalytics();

const VIEWS = ['overview', 'projects', 'agents', 'models', 'settings'];
const VIEW_TITLES = {
  overview: 'Overview',
  projects: 'Projects',
  agents: 'Agent',
  models: 'Models',
  settings: 'Settings',
};

const PROVIDERS = [
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'google', name: 'Google/Gemini' },
];

let currentUser = null;
let dashboardData = {
  projects: [],
  agents: [],
  settings: {},
  projectsState: 'loading',
  agentsState: 'loading',
  settingsState: 'loading',
};

let pendingProviderId = null;

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
const providerModal = document.getElementById('provider-modal');
const providerStatusSelect = document.getElementById('provider-status');
const providerModalAlert = document.getElementById('provider-modal-alert');
const providerModalTitle = document.getElementById('provider-modal-title');

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
  if (view === 'usage' || view === 'billing') view = 'overview';
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

function openProviderModal(providerId) {
  const provider = PROVIDERS.find(function (p) { return p.id === providerId; });
  if (!provider) return;

  pendingProviderId = providerId;
  providerModalTitle.textContent = 'Configure ' + provider.name;
  providerStatusSelect.value = dashboardData.settings[providerId]?.status || 'not-configured';
  providerModalAlert.classList.remove('visible');
  providerModal.hidden = false;
  providerModal.classList.add('open');
}

function closeProviderModal() {
  providerModal.classList.remove('open');
  providerModal.hidden = true;
  pendingProviderId = null;
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

function getConfiguredModels(settings) {
  const models = [];
  PROVIDERS.forEach(function (p) {
    const s = settings[p.id];
    if (!s || s.status !== 'connected' || !Array.isArray(s.models)) return;
    s.models.forEach(function (m) {
      if (!m || !m.name) return;
      const caps = Array.isArray(m.capabilities)
        ? m.capabilities.join(' · ')
        : (m.capabilities || '');
      models.push({ name: m.name, provider: p.name, capabilities: caps });
    });
  });
  return models;
}

function renderOverview() {
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

function renderModelsView() {
  const container = document.getElementById('models-container');
  if (dashboardData.settingsState === 'loading') {
    container.innerHTML = renderSkeleton(3);
    return;
  }

  const models = getConfiguredModels(dashboardData.settings);

  if (models.length === 0) {
    container.innerHTML = renderEmptyState(
      'No models available',
      'Configure AI providers in Settings. Only models connected through your providers will appear here.',
      'Go to Settings',
      'go-settings'
    );
    return;
  }

  container.innerHTML =
    '<div class="dash-project-list">' +
    models.map(function (m) {
      return (
        '<div class="dash-model-card">' +
          '<h3>' + escapeHtml(m.name) + '</h3>' +
          '<p>' + escapeHtml(m.provider) + (m.capabilities ? ' · ' + escapeHtml(m.capabilities) : '') + '</p>' +
        '</div>'
      );
    }).join('') +
    '</div>';
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

  let providersHtml = '';
  PROVIDERS.forEach(function (p) {
    const s = dashboardData.settings[p.id];
    const status = s?.status || 'not-configured';
    const statusLabel = status === 'connected' ? 'Connected' : status === 'invalid' ? 'Invalid' : 'Not configured';
    const statusClass = status === 'connected' ? 'connected' : status === 'invalid' ? 'invalid' : 'not-configured';

    providersHtml +=
      '<div class="dash-settings-row">' +
        '<div><label>' + escapeHtml(p.name) + '</label></div>' +
        '<div style="display:flex;align-items:center;gap:0.75rem;">' +
          '<span class="dash-provider-status ' + statusClass + '">' + statusLabel + '</span>' +
          '<button type="button" class="dash-btn-ghost" data-configure-provider="' + p.id + '">Configure</button>' +
        '</div>' +
      '</div>';
  });

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
    '</div>' +
    '<div class="dash-settings-group">' +
      '<h2>AI Providers</h2>' +
      '<p style="color:var(--dash-text-muted);font-size:0.875rem;margin-bottom:1rem;">Provider connection status for your workspace. API keys are never displayed here.</p>' +
      '<div class="dash-settings-card">' + providersHtml + '</div>' +
    '</div>';

  document.getElementById('settings-sign-out')?.addEventListener('click', handleSignOut);
}

function renderAll() {
  renderOverview();
  renderProjectsView();
  renderAgentsView();
  renderModelsView();
  renderSettingsView();
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

async function loadSettings() {
  if (!currentUser) return;
  dashboardData.settingsState = 'loading';
  renderModelsView();
  renderSettingsView();

  try {
    dashboardData.settings = await fetchUserSettings(currentUser.uid);
    dashboardData.settingsState = 'loaded';
  } catch (err) {
    console.error('[LOQUIRA] Settings load error:', err);
    dashboardData.settings = {};
    dashboardData.settingsState = 'loaded';
  }

  renderModelsView();
  renderSettingsView();
}

async function loadDashboardData() {
  await Promise.all([loadProjects(), loadAgents(), loadSettings()]);
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

async function saveProviderConfig() {
  if (!pendingProviderId || !currentUser) return;

  const provider = PROVIDERS.find(function (p) { return p.id === pendingProviderId; });
  const status = providerStatusSelect.value;

  try {
    await saveProviderSetting(currentUser.uid, pendingProviderId, {
      status: status,
      name: provider.name,
    });
    closeProviderModal();
    await loadSettings();
  } catch (err) {
    console.error('[LOQUIRA] Provider save error:', err);
    providerModalAlert.textContent = 'Could not save provider settings. Please try again.';
    providerModalAlert.classList.add('visible');
  }
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

document.querySelectorAll('[data-view]').forEach(function (el) {
  if (el.classList.contains('dash-nav-item')) return;
  el.addEventListener('click', function () {
    navigateTo(el.dataset.view);
  });
});

document.addEventListener('click', function (e) {
  const actionEl = e.target.closest('[data-action]');
  if (actionEl) {
    handleQuickAction(actionEl.dataset.action);
    return;
  }

  const openEl = e.target.closest('[data-open-project]');
  if (openEl) {
    handleOpenProject(openEl.dataset.openProject);
    return;
  }

  const providerEl = e.target.closest('[data-configure-provider]');
  if (providerEl) {
    openProviderModal(providerEl.dataset.configureProvider);
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

document.getElementById('provider-modal-cancel').addEventListener('click', closeProviderModal);
document.getElementById('provider-modal-save').addEventListener('click', saveProviderConfig);
providerModal.addEventListener('click', function (e) {
  if (e.target === providerModal) closeProviderModal();
});

document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    closeProjectModal();
    closeWorkspaceNotice();
    closeProviderModal();
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
});
