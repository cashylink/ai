import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import { getAnalytics, isSupported } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-analytics.js';

const firebaseConfig = {
  apiKey: 'AIzaSyAZiqyuhQ_dmE6HCByrgMrID5yZhjNOYsw',
  authDomain: 'aiprogekt-155e1.firebaseapp.com',
  projectId: 'aiprogekt-155e1',
  storageBucket: 'aiprogekt-155e1.firebasestorage.app',
  messagingSenderId: '890425930543',
  appId: '1:890425930543:web:a8a457158718aaf93e27da',
  measurementId: 'G-N586GE3Z43',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

let analyticsInstance = null;

export async function initAnalytics() {
  if (analyticsInstance) return analyticsInstance;
  try {
    const supported = await isSupported();
    if (supported) {
      analyticsInstance = getAnalytics(app);
    }
  } catch (_) {
    /* analytics unavailable in some environments */
  }
  return analyticsInstance;
}
