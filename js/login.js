import {
  signInWithEmail,
  signInWithGoogle,
  handleGoogleRedirectResult,
  resetPassword,
  getAuthErrorMessage,
  watchAuth,
} from './auth.js';
import { initAnalytics } from './firebase-config.js';
import { isDesktopAuthFlow, completeDesktopHandoff } from './desktop-auth.js';
import { ensureWebAuthUrl } from './auth-source.js';

initAnalytics();

// Capture desktop handoff params BEFORE any URL cleanup (production bug fix).
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

watchAuth(async function (user) {
  if (!user) return;
  if (desktopFlow) {
    try {
      await completeDesktopHandoff(user);
    } catch (err) {
      showAlert('تم تسجيل الدخول، لكن تعذر إكمال تسجيل الدخول إلى تطبيق LOQUIRA.', 'error');
    }
    return;
  }
  window.location.href = 'workspace.html';
});

handleGoogleRedirectResult()
  .then(async function (user) {
    if (!user) return;
    if (desktopFlow) {
      try {
        await completeDesktopHandoff(user);
      } catch (err) {
        showAlert('تم تسجيل الدخول، لكن تعذر إكمال تسجيل الدخول إلى تطبيق LOQUIRA.', 'error');
      }
      return;
    }
    window.location.href = 'workspace.html';
  })
  .catch(function (err) {
    showAlert(getAuthErrorMessage(err.code), 'error');
  });

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
  if (!googleOnly) {
    submitBtn.textContent = loading ? 'Signing in…' : 'Sign in';
  }
}

async function afterSignIn(user) {
  if (!user) return;
  if (desktopFlow) {
    try {
      await completeDesktopHandoff(user);
    } catch (err) {
      showAlert('تم تسجيل الدخول، لكن تعذر إكمال تسجيل الدخول إلى تطبيق LOQUIRA.', 'error');
    }
    return;
  }
  window.location.href = 'workspace.html';
}

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
