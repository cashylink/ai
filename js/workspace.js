import { watchAuth, logOut } from './auth.js';
import { initAnalytics } from './firebase-config.js';

initAnalytics();

const loadingEl = document.getElementById('workspace-loading');
const contentEl = document.getElementById('workspace-content');
const userNameEl = document.getElementById('user-name');
const userEmailEl = document.getElementById('user-email');
const userAvatarEl = document.getElementById('user-avatar');
const signOutBtn = document.getElementById('sign-out-btn');

watchAuth(function (user) {
  if (!user) {
    window.location.href = 'login.html';
    return;
  }

  const name = user.displayName || user.email.split('@')[0];
  const initial = name.charAt(0).toUpperCase();

  userNameEl.textContent = name;
  userEmailEl.textContent = user.email;
  userAvatarEl.textContent = initial;

  loadingEl.style.display = 'none';
  contentEl.style.display = 'block';
});

signOutBtn.addEventListener('click', async function () {
  signOutBtn.disabled = true;
  try {
    await logOut();
    window.location.href = 'index.html';
  } catch (_) {
    signOutBtn.disabled = false;
  }
});
