/**
 * LOQUIRA desktop auth success — presentation & automatic handoff launch.
 * Auth state is passed only via the one-time `state` query param (no tokens).
 */

import { openDesktopApp } from './desktop-auth.js';

const COPY = {
  signingIn: 'جاري تسجيل الدخول…',
  signedIn: 'تم تسجيل الدخول',
  workspaceReady: 'مساحة عمل <span class="brand-ltr">LOQUIRA</span> جاهزة.',
  opening: 'جاري فتح LOQUIRA',
  launchedTitle: 'تم تسجيل الدخول بنجاح',
  launchedSubtitle: 'تم فتح LOQUIRA.',
  launchedHint: 'يمكنك إغلاق هذه النافذة.',
  fallbackPrompt: 'لم يتم فتح التطبيق تلقائيًا؟',
  errorTitle: 'تعذر فتح LOQUIRA تلقائيًا',
  errorSubtitle: 'يمكنك فتح التطبيق يدويًا للمتابعة.',
  invalidSession: 'جلسة تسجيل الدخول غير صالحة أو منتهية.',
};

const TIMING = {
  success: 520,
  workspace: 880,
  launch: 1100,
  fallbackDelay: 4000,
};

const params = new URLSearchParams(window.location.search);
const state = (params.get('state') || '').trim();

const els = {
  cluster: document.getElementById('handoff-cluster'),
  spinner: document.getElementById('handoff-spinner'),
  check: document.getElementById('handoff-check'),
  title: document.getElementById('handoff-title'),
  subtitle: document.getElementById('handoff-subtitle'),
  status: document.getElementById('handoff-status'),
  statusText: document.getElementById('handoff-status-text'),
  dots: document.getElementById('handoff-dots'),
  fallback: document.getElementById('handoff-fallback'),
  fallbackMsg: document.getElementById('handoff-fallback-msg'),
  openBtn: document.getElementById('open-app-btn'),
  main: document.querySelector('.handoff-main'),
};

let launchAttempted = false;
let fallbackVisible = false;
let launchSucceeded = false;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setTitle(text) {
  els.title.textContent = text;
}

function setSubtitleHtml(html) {
  if (!html) {
    els.subtitle.innerHTML = '';
    return;
  }
  els.subtitle.innerHTML = html;
}

function setStatus(text, showDots = false) {
  if (!text && !showDots) {
    els.status.hidden = true;
    els.statusText.textContent = '';
    return;
  }
  els.status.hidden = false;
  els.statusText.textContent = text;
  els.dots.hidden = !showDots;
}

function showSuccessCheck() {
  els.spinner.hidden = true;
  els.check.hidden = false;
  requestAnimationFrame(() => els.check.classList.add('is-visible'));
  els.cluster?.classList.add('is-success');
}

function setBusy(busy) {
  els.main?.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function showLaunchSuccess() {
  if (launchSucceeded) {
    return;
  }
  launchSucceeded = true;
  setBusy(false);
  setTitle(COPY.launchedTitle);
  setSubtitleHtml(COPY.launchedSubtitle);
  setStatus(COPY.launchedHint, false);
  els.fallback.hidden = true;
}

function showFallback(isError = false) {
  if (fallbackVisible || launchSucceeded) {
    return;
  }
  fallbackVisible = true;
  setBusy(false);

  if (isError) {
    els.cluster?.classList.add('is-error');
    els.spinner.hidden = true;
    els.check.hidden = false;
    els.check.classList.add('is-visible');
    setTitle(COPY.errorTitle);
    setSubtitleHtml(COPY.errorSubtitle);
    setStatus('', false);
    els.fallbackMsg.textContent = COPY.errorSubtitle;
  } else {
    els.fallbackMsg.textContent = COPY.fallbackPrompt;
  }

  els.fallback.hidden = false;
  requestAnimationFrame(() => els.fallback.classList.add('is-visible'));
}

function attemptLaunch() {
  if (!state || launchAttempted) {
    if (!state) {
      showFallback(true);
    }
    return;
  }

  launchAttempted = true;
  setTitle(COPY.signedIn);
  setSubtitleHtml(COPY.workspaceReady);
  setStatus(`${COPY.opening}…`, true);

  let cleaned = false;
  const cleanup = (succeeded = false) => {
    if (cleaned) {
      return;
    }
    cleaned = true;
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    clearTimeout(fallbackTimer);
    if (succeeded) {
      showLaunchSuccess();
    }
  };

  const onBlur = () => cleanup(true);
  const onVisibility = () => {
    if (document.hidden) {
      cleanup(true);
    }
  };

  const fallbackTimer = setTimeout(() => {
    if (!document.hidden && !launchSucceeded) {
      showFallback(false);
    }
    cleanup(false);
  }, TIMING.fallbackDelay);

  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  try {
    openDesktopApp(state);
  } catch {
    cleanup(false);
    showFallback(true);
  }
}

function runSequence() {
  const scale = reducedMotion ? 0.4 : 1;
  const t = (ms) => Math.round(ms * scale);

  setTitle(COPY.signingIn);
  setSubtitleHtml('');
  setStatus('', false);
  els.spinner.hidden = false;
  els.check.hidden = true;
  els.check.classList.remove('is-visible');

  setTimeout(() => {
    showSuccessCheck();
    setTitle(COPY.signedIn);
    setSubtitleHtml(COPY.workspaceReady);
    setStatus('', false);
  }, t(TIMING.success));

  setTimeout(() => {
    setStatus(`${COPY.opening}…`, true);
  }, t(TIMING.workspace));

  setTimeout(attemptLaunch, t(TIMING.launch));
}

els.openBtn?.addEventListener('click', () => {
  if (state) {
    openDesktopApp(state);
  }
});

if (!state) {
  els.cluster?.classList.add('is-error');
  setTitle(COPY.errorTitle);
  setSubtitleHtml(COPY.invalidSession);
  els.spinner.hidden = true;
  showFallback(true);
} else {
  runSequence();
}
