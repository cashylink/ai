/**
 * LOQUIRA desktop auth success — presentation & automatic handoff launch.
 * Auth state is passed only via the one-time `state` query param (no tokens).
 */

import { openDesktopApp } from './desktop-auth.js';

const COPY = {
  signingIn: 'جاري تسجيل الدخول…',
  signedIn: 'تم تسجيل الدخول بنجاح',
  workspaceReady: 'مساحة عمل LOQUIRA جاهزة.',
  opening: 'جاري فتح LOQUIRA',
  fallbackTitle: 'تعذّر فتح LOQUIRA تلقائياً',
  fallbackBody: 'حسابك جاهز. افتح LOQUIRA للمتابعة.',
  openApp: 'فتح LOQUIRA',
  returnWeb: 'العودة إلى الموقع',
};

const TIMING = {
  signIn: 380,
  success: 720,
  workspace: 1050,
  launch: 1280,
  fallbackDelay: 2800,
};

const params = new URLSearchParams(window.location.search);
const state = (params.get('state') || '').trim();

const els = {
  stage: document.getElementById('handoff-stage'),
  spinner: document.getElementById('handoff-spinner'),
  checkRing: document.getElementById('handoff-check-ring'),
  checkIcon: document.getElementById('handoff-check-icon'),
  title: document.getElementById('handoff-title'),
  subtitle: document.getElementById('handoff-subtitle'),
  status: document.getElementById('handoff-status'),
  statusText: document.getElementById('handoff-status-text'),
  dots: document.getElementById('handoff-dots'),
  fallback: document.getElementById('handoff-fallback'),
  fallbackMsg: document.getElementById('handoff-fallback-msg'),
  openBtn: document.getElementById('open-app-btn'),
  returnLink: document.getElementById('return-website'),
};

let launchAttempted = false;
let fallbackVisible = false;
let reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function setTitle(text) {
  els.title.textContent = text;
}

function setSubtitle(text) {
  els.subtitle.textContent = text;
}

function setStatus(text, showDots = false) {
  els.statusText.textContent = text;
  els.dots.hidden = !showDots;
}

function showSuccessCheck() {
  els.spinner.hidden = true;
  els.checkRing.classList.add('is-visible');
  els.checkIcon.classList.add('is-visible');
  els.checkRing.setAttribute('aria-hidden', 'false');
}

function showFallback(isError = false) {
  if (fallbackVisible) {
    return;
  }
  fallbackVisible = true;

  if (isError) {
    els.stage.classList.add('is-error');
    setTitle(COPY.fallbackTitle);
    setSubtitle(COPY.fallbackBody);
    setStatus('', false);
  }

  els.fallbackMsg.textContent = COPY.fallbackBody;
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
  setSubtitle(COPY.workspaceReady);
  setStatus(`${COPY.opening}…`, true);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibility);
    clearTimeout(fallbackTimer);
  };

  const onBlur = () => cleanup();
  const onVisibility = () => {
    if (document.hidden) {
      cleanup();
    }
  };

  const fallbackTimer = setTimeout(() => {
    cleanup();
    if (!document.hidden) {
      showFallback();
    }
  }, TIMING.fallbackDelay);

  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibility);

  try {
    openDesktopApp(state);
  } catch {
    cleanup();
    showFallback(true);
  }
}

function runSequence() {
  const scale = reducedMotion ? 0.35 : 1;
  const t = (ms) => Math.round(ms * scale);

  setTitle(COPY.signingIn);
  setSubtitle('');
  setStatus('', false);
  els.spinner.hidden = false;

  setTimeout(() => {
    showSuccessCheck();
    setTitle(COPY.signedIn);
    setSubtitle(COPY.workspaceReady);
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

els.returnLink?.setAttribute('href', 'index.html');

if (!state) {
  els.stage.classList.add('is-error');
  setTitle(COPY.fallbackTitle);
  setSubtitle('جلسة تسجيل الدخول غير صالحة أو منتهية.');
  els.spinner.hidden = true;
  showFallback(true);
} else {
  runSequence();
}
