import {
  signInWithEmail,
  signInWithGoogle,
  handleGoogleRedirectResult,
  resetPassword,
  getAuthErrorMessage,
  watchAuth,
  logOut,
} from './auth.js';
import { initAnalytics } from './firebase-config.js';
import { isDesktopAuthFlow, completeDesktopHandoff } from './desktop-auth.js';
import { ensureWebAuthUrl } from './auth-source.js';

initAnalytics();

const desktopFlow = isDesktopAuthFlow();
if (!desktopFlow) {
  ensureWebAuthUrl();
}

const form = document.getElementById('login-form');
const alertEl = document.getElementById('auth-alert');
const submitBtn = document.getElementById('submit-btn');
const googleBtn = document.getElementById('google-btn');
const forgotLink = document.getElementById('forgot-password');

if (desktopFlow) {
  document.title = 'تسجيل الدخول — LOQUIRA Desktop';
}

function showAlert(message, type) {
  alertEl.textContent = message;
  alertEl.className = 'auth-alert visible ' + type;
}

function hideAlert() {
  alertEl.className = 'auth-alert';
}

function setLoading(loading, googleOnly) {
  submitBtn.disabled = loading;
  googleBtn.disabled = loading;
  googleBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  if (!googleOnly) {
    submitBtn.textContent = loading ? 'Signing in…' : 'Sign in';
  }
}

function desktopHandoffErrorMessage(err) {
  const code = String(err?.message || err || '');
  if (code === 'WORKER_NOT_REACHABLE' || code === 'HANDOFF_FAILED') {
    return 'تم تسجيل الدخول، لكن تعذر إكمال تسجيل الدخول إلى تطبيق LOQUIRA.';
  }
  if (code === 'SESSION_EXPIRED' || code === 'invalid_state') {
    return 'انتهت جلسة تسجيل الدخول. ارجع إلى LOQUIRA واضغط Continue with Google مرة أخرى.';
  }
  return 'تم تسجيل الدخول، لكن تعذر إكمال تسجيل الدخول إلى تطبيق LOQUIRA.';
}

function showDesktopRetry() {
  if (document.getElementById('desktop-retry-btn')) return;
  const btn = document.createElement('button');
  btn.id = 'desktop-retry-btn';
  btn.type = 'button';
  btn.className = 'btn btn-primary btn-lg btn-full';
  btn.style.marginTop = '12px';
  btn.textContent = 'إعادة المحاولة';
  btn.addEventListener('click', async () => {
    hideAlert();
    btn.remove();
    googleBtn.click();
  });
  alertEl.parentElement?.appendChild(btn);
}

async function handleDesktopSignIn(user) {
  if (!user) return;
  setLoading(true, true);
  try {
    await completeDesktopHandoff(user);
  } catch (err) {
    showAlert(desktopHandoffErrorMessage(err), 'error');
    showDesktopRetry();
    try { await logOut(); } catch (_) { /* allow retry */ }
  } finally {
    setLoading(false, true);
  }
}

async function handleWebSignIn(user) {
  if (!user) return;
  window.location.href = 'workspace.html';
}

async function afterSignIn(user) {
  if (!user) return;
  if (desktopFlow) {
    await handleDesktopSignIn(user);
    return;
  }
  await handleWebSignIn(user);
}

watchAuth(async function (user) {
  if (!user) return;
  if (desktopFlow) {
    await handleDesktopSignIn(user);
    return;
  }
  window.location.href = 'workspace.html';
});

handleGoogleRedirectResult()
  .then(async function (user) {
    if (!user) return;
    await afterSignIn(user);
  })
  .catch(function (err) {
    showAlert(getAuthErrorMessage(err.code), 'error');
    setLoading(false, true);
  });

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  hideAlert();

  const email = form.email.value.trim();
  const password = form.password.value;

  if (!email || !password) {
    showAlert('Please enter your email and password.', 'error');
    return;
  }

  setLoading(true);
  try {
    const user = await signInWithEmail(email, password);
    await afterSignIn(user);
  } catch (err) {
    showAlert(getAuthErrorMessage(err.code), 'error');
  } finally {
    setLoading(false);
  }
});

googleBtn.addEventListener('click', async function () {
  if (googleBtn.disabled) return;
  hideAlert();
  setLoading(true, true);
  try {
    const user = await signInWithGoogle();
    if (user) {
      await afterSignIn(user);
    }
  } catch (err) {
    if (err.code !== 'auth/popup-closed-by-user') {
      showAlert(getAuthErrorMessage(err.code), 'error');
    }
  } finally {
    setLoading(false, true);
  }
});

forgotLink.addEventListener('click', async function (e) {
  e.preventDefault();
  hideAlert();

  const email = form.email.value.trim();
  if (!email) {
    showAlert('Enter your email above, then click forgot password.', 'error');
    return;
  }

  try {
    await resetPassword(email);
    showAlert('Password reset email sent. Check your inbox.', 'success');
  } catch (err) {
    showAlert(getAuthErrorMessage(err.code), 'error');
  }
});
