import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { auth } from './firebase-config.js';

const googleProvider = new GoogleAuthProvider();
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function watchAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

export async function signUpWithEmail(name, email, password) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  if (name.trim()) {
    await updateProfile(credential.user, { displayName: name.trim() });
  }
  return credential.user;
}

export async function signInWithEmail(email, password) {
  const credential = await signInWithEmailAndPassword(auth, email, password);
  return credential.user;
}

export async function signInWithGoogle() {
  try {
    const credential = await signInWithPopup(auth, googleProvider);
    return credential.user;
  } catch (err) {
    if (
      err.code === 'auth/popup-blocked' ||
      err.code === 'auth/cancelled-popup-request' ||
      err.code === 'auth/operation-not-supported-in-this-environment'
    ) {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    throw err;
  }
}

export async function handleGoogleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (err) {
    console.error('[LOQUIRA] Google redirect error:', err);
    throw err;
  }
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

export async function logOut() {
  await signOut(auth);
}

export function getAuthErrorMessage(code, context) {
  const hostname = context?.hostname || (typeof window !== 'undefined' ? window.location.hostname : '');

  const messages = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/operation-not-allowed': 'Google sign-in is not enabled yet. Enable Google in Firebase Console → Authentication → Sign-in method.',
    'auth/weak-password': 'Password must be at least 6 characters.',
    'auth/user-disabled': 'This account has been disabled.',
    'auth/user-not-found': 'No account found with this email.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Invalid email or password.',
    'auth/too-many-requests': 'Too many attempts. Please wait and try again.',
    'auth/popup-closed-by-user': 'Sign-in was cancelled.',
    'auth/popup-blocked': 'Popup was blocked. Trying redirect sign-in…',
    'auth/unauthorized-domain': hostname
      ? 'Sign-in is not enabled for "' + hostname + '". In Firebase Console → Authentication → Settings → Authorized domains, add: ' + hostname
      : 'Sign-in is not enabled for this site address. Add your domain in Firebase Console → Authentication → Authorized domains.',
    'auth/account-exists-with-different-credential': 'An account already exists with this email using a different sign-in method.',
    'auth/network-request-failed': 'Network error. Check your connection.',
    'auth/cancelled-popup-request': 'Sign-in was interrupted. Please try again.',
  };
  return messages[code] || 'Something went wrong. Please try again.';
}
