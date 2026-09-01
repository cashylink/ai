import { watchAuth } from './auth.js';
import { initAnalytics } from './firebase-config.js';

initAnalytics();

const navActions = document.querySelector('.nav-actions');
const mobileMenu = document.querySelector('.mobile-menu');

if (!navActions) return;

watchAuth(function (user) {
  if (user) {
    const name = user.displayName || user.email.split('@')[0];
    navActions.innerHTML =
      '<div class="nav-user-menu">' +
        '<span class="nav-user-email">' + escapeHtml(user.email) + '</span>' +
        '<a href="workspace.html" class="btn btn-primary">Workspace</a>' +
      '</div>';

    if (mobileMenu) {
      const signInLink = mobileMenu.querySelector('.nav-signin');
      const ctaBtn = mobileMenu.querySelector('.btn-primary');
      if (signInLink) signInLink.href = 'workspace.html';
      if (signInLink) signInLink.textContent = 'Workspace';
      if (ctaBtn) {
        ctaBtn.href = 'workspace.html';
        ctaBtn.textContent = 'Open workspace';
      }
    }
  }
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
