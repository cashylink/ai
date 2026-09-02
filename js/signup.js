import {
  signUpWithEmail,
  signInWithGoogle,
  handleGoogleRedirectResult,
  getAuthErrorMessage,
  watchAuth,
} from './auth.js';
import { initAnalytics } from './firebase-config.js';
import { isDesktopAuthFlow, completeDesktopHandoff } from './desktop-auth.js';
import { ensureWebAuthUrl } from './auth-source.js';

initAnalytics();

const desktopFlow = isDesktopAuthFlow();
if (!desktopFlow) {
  ensureWebAuthUrl();
}

const form = document.getElementById('signup-form');
const alertEl = document.getElementById('auth-alert');
const submitBtn = document.getElementById('submit-btn');
const googleBtn = document.getElementById('google-btn');

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
    submitBtn.textContent = loading ? 'Creating account…' : 'Create account';
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

  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  const confirm = form.confirm.value;

  if (!name || !email || !password) {
    showAlert('Please fill in all fields.', 'error');
    return;
  }

  if (password.length < 6) {
    showAlert('Password must be at least 6 characters.', 'error');
    return;
  }

  if (password !== confirm) {
    showAlert('Passwords do not match.', 'error');
    return;
  }

  setLoading(true);
  try {
    const user = await signUpWithEmail(name, email, password);
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
