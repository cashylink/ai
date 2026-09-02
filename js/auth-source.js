/**
 * LOQUIRA auth client discriminator.
 * WEB  — hosted website (Firebase only, no localhost callbacks).
 * DESKTOP — opened from LOQUIRA Desktop with handoff params.
 */

export const AUTH_SOURCE = Object.freeze({
  WEB: 'web',
  DESKTOP: 'desktop',
});

export function getAuthSource() {
  const params = new URLSearchParams(window.location.search);
  if (params.get('client') !== 'desktop') {
    return AUTH_SOURCE.WEB;
  }
  const state = (params.get('state') || '').trim();
  if (!state) {
    return AUTH_SOURCE.WEB;
  }
  return AUTH_SOURCE.DESKTOP;
}

/** Remove stale desktop query params when user is on the normal hosted login page. */
export function ensureWebAuthUrl() {
  if (getAuthSource() !== AUTH_SOURCE.WEB) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (!params.has('client') && !params.has('state')) {
    return;
  }
  params.delete('client');
  params.delete('state');
  params.delete('agentPort');
  const qs = params.toString();
  const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
  window.history.replaceState(null, '', clean);
}
