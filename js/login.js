import {
  signInWithEmail,
  signInWithGoogle,
  handleGoogleRedirectResult,
  resetPassword,
  getAuthErrorMessage,
  watchAuth,
} from './auth.js';
import { initAnalytics } from './firebase-config.js';

initAnalytics();

const form = document.getElementById('login-form');
const alertEl = document.getElementById('auth-alert');
const submitBtn = document.getElementById('submit-btn');
const googleBtn = document.getElementById('google-btn');
const forgotLink = document.getElementById('forgot-password');

watchAuth(function (user) {
  if (user) {
    window.location.href = 'workspace.html';
  }
});

handleGoogleRedirectResult()
  .then(function (user) {
    if (user) window.location.href = 'workspace.html';
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
    await signInWithEmail(email, password);
    window.location.href = 'workspace.html';
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
      window.location.href = 'workspace.html';
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
